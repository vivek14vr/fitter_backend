import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import {
  MAX_TESTIMONIAL_IMAGE_SIZE,
  TESTIMONIAL_IMAGE_TYPES,
} from './dto/create-testimonial-upload.dto.js';

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const READ_URL_TTL_SECONDS = 60 * 60;
const extensionByType: Record<(typeof TESTIMONIAL_IMAGE_TYPES)[number], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

function envValue(name: string) {
  return process.env[name]?.trim() ?? '';
}

@Injectable()
export class TestimonialStorageService {
  private readonly logger = new Logger(TestimonialStorageService.name);
  private client: S3Client | null = null;

  isConfigured() {
    const accessKeyId = envValue('AWS_ACCESS_KEY_ID');
    const secretAccessKey = envValue('AWS_SECRET_ACCESS_KEY');
    const hasPartialStaticCredentials = Boolean(accessKeyId) !== Boolean(secretAccessKey);
    return Boolean(envValue('AWS_REGION') && envValue('AWS_S3_BUCKET')) && !hasPartialStaticCredentials;
  }

  async createUpload(input: {
    contentType: (typeof TESTIMONIAL_IMAGE_TYPES)[number];
    fileSize: number;
  }) {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('S3 image storage is not configured yet');
    }

    const bucket = envValue('AWS_S3_BUCKET');
    const region = envValue('AWS_REGION');
    const prefix = envValue('AWS_S3_TESTIMONIAL_PREFIX') || 'testimonials';
    const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '');
    const objectKey = `${normalizedPrefix}/pending/${randomUUID()}.${extensionByType[input.contentType]}`;
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: input.contentType,
      ContentLength: input.fileSize,
      CacheControl: 'public,max-age=31536000,immutable',
    });
    const uploadUrl = await getSignedUrl(this.getClient(), command, {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    });

    return {
      objectKey,
      uploadUrl,
      publicUrl: this.publicUrl(bucket, region, objectKey),
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      contentType: input.contentType,
    };
  }

  async promoteObject(objectKey: string) {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('S3 image storage is not configured yet');
    }

    const bucket = envValue('AWS_S3_BUCKET');
    const region = envValue('AWS_REGION');
    const prefix = (envValue('AWS_S3_TESTIMONIAL_PREFIX') || 'testimonials').replace(/^\/+|\/+$/g, '');
    const pendingPrefix = `${prefix}/pending/`;
    const verified = await this.verifyUploadedImage(objectKey);

    if (!objectKey.startsWith(pendingPrefix)) {
      return {
        objectKey,
        publicUrl: this.publicUrl(bucket, region, objectKey),
      };
    }

    const finalObjectKey = `${prefix}/${objectKey.slice(pendingPrefix.length)}`;
    await this.getClient().send(new CopyObjectCommand({
      Bucket: bucket,
      Key: finalObjectKey,
      CopySource: `${bucket}/${objectKey.split('/').map((part) => encodeURIComponent(part)).join('/')}`,
      MetadataDirective: 'REPLACE',
      ContentType: verified.contentType,
      CacheControl: 'public,max-age=31536000,immutable',
    }));
    await this.deleteObject(objectKey);

    return {
      objectKey: finalObjectKey,
      publicUrl: this.publicUrl(bucket, region, finalObjectKey),
    };
  }

  async verifyUploadedImage(objectKey: string) {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('S3 image storage is not configured yet');
    }

    const bucket = envValue('AWS_S3_BUCKET');
    this.assertManagedObjectKey(objectKey);

    let head: HeadObjectCommandOutput;
    try {
      head = await this.getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
    } catch {
      throw new BadRequestException('Uploaded testimonial image could not be found in storage');
    }

    const contentLength = head.ContentLength ?? 0;
    if (!Number.isInteger(contentLength) || contentLength < 1 || contentLength > MAX_TESTIMONIAL_IMAGE_SIZE) {
      throw new BadRequestException('Uploaded testimonial image exceeds the 10 MB limit');
    }

    const contentType = head.ContentType?.split(';', 1)[0]?.trim().toLowerCase();
    if (!contentType || !TESTIMONIAL_IMAGE_TYPES.includes(contentType as (typeof TESTIMONIAL_IMAGE_TYPES)[number])) {
      throw new BadRequestException('Uploaded testimonial image has an unsupported content type');
    }

    return { contentLength, contentType };
  }

  async deleteObject(objectKey: string) {
    if (!this.isConfigured()) return;
    try {
      this.assertManagedObjectKey(objectKey);
      await this.getClient().send(new DeleteObjectCommand({
        Bucket: envValue('AWS_S3_BUCKET'),
        Key: objectKey,
      }));
    } catch (error) {
      this.logger.warn(JSON.stringify({
        event: 'testimonial.storage.delete_failed',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
    }
  }

  async resolveImageUrl(objectKey: string | null | undefined, fallbackUrl: string) {
    if (!this.isConfigured()) return fallbackUrl;

    const bucket = envValue('AWS_S3_BUCKET');
    const region = envValue('AWS_REGION');
    const resolvedObjectKey = objectKey?.trim() || this.objectKeyFromFallbackUrl(fallbackUrl, bucket, region);
    if (!resolvedObjectKey) return fallbackUrl;
    const publicBaseUrl = envValue('AWS_S3_PUBLIC_BASE_URL');

    if (publicBaseUrl && !this.isDirectS3Origin(publicBaseUrl)) {
      return this.publicUrl(bucket, region, resolvedObjectKey);
    }

    try {
      this.assertManagedObjectKey(resolvedObjectKey);
      return await getSignedUrl(
        this.getClient(),
        new GetObjectCommand({ Bucket: bucket, Key: resolvedObjectKey }),
        { expiresIn: READ_URL_TTL_SECONDS },
      );
    } catch (error) {
      this.logger.warn(JSON.stringify({
        event: 'testimonial.storage.read_url_failed',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      return fallbackUrl;
    }
  }

  private getClient() {
    if (!this.client) {
      const accessKeyId = envValue('AWS_ACCESS_KEY_ID');
      const secretAccessKey = envValue('AWS_SECRET_ACCESS_KEY');
      this.client = new S3Client({
        region: envValue('AWS_REGION'),
        ...(accessKeyId && secretAccessKey
          ? { credentials: { accessKeyId, secretAccessKey } }
          : {}),
      });
    }
    return this.client;
  }

  private publicUrl(bucket: string, region: string, objectKey: string) {
    const baseUrl = envValue('AWS_S3_PUBLIC_BASE_URL')
      || `https://${bucket}.s3.${region}.amazonaws.com`;
    const encodedKey = objectKey.split('/').map((part) => encodeURIComponent(part)).join('/');
    return `${baseUrl.replace(/\/+$/, '')}/${encodedKey}`;
  }

  private isDirectS3Origin(value: string) {
    try {
      const hostname = new URL(value).hostname.toLowerCase();
      return hostname === 's3.amazonaws.com'
        || hostname.startsWith('s3.')
        || hostname.startsWith('s3-')
        || hostname.endsWith('.s3.amazonaws.com')
        || hostname.includes('.s3.')
        || hostname.includes('.s3-');
    } catch {
      return false;
    }
  }

  private objectKeyFromFallbackUrl(value: string, bucket: string, region: string) {
    try {
      const parsed = new URL(value);
      const hostname = parsed.hostname.toLowerCase();
      const normalizedBucket = bucket.toLowerCase();
      const normalizedRegion = region.toLowerCase();
      const virtualHostedOrigins = new Set([
        `${normalizedBucket}.s3.amazonaws.com`,
        `${normalizedBucket}.s3.${normalizedRegion}.amazonaws.com`,
        `${normalizedBucket}.s3-${normalizedRegion}.amazonaws.com`,
      ]);
      const pathStyleOrigins = new Set([
        's3.amazonaws.com',
        `s3.${normalizedRegion}.amazonaws.com`,
        `s3-${normalizedRegion}.amazonaws.com`,
      ]);

      let pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
      if (virtualHostedOrigins.has(hostname)) return pathname;
      if (pathStyleOrigins.has(hostname) && pathname.startsWith(`${bucket}/`)) {
        pathname = pathname.slice(bucket.length + 1);
        return pathname;
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private assertManagedObjectKey(objectKey: string) {
    const prefix = envValue('AWS_S3_TESTIMONIAL_PREFIX') || 'testimonials';
    const managedPrefix = `${prefix.replace(/^\/+|\/+$/g, '')}/`;
    if (!objectKey.startsWith(managedPrefix) || objectKey.length <= managedPrefix.length) {
      throw new BadRequestException('Invalid testimonial storage object key');
    }
  }
}
