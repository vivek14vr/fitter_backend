import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { TESTIMONIAL_IMAGE_TYPES } from './dto/create-testimonial-upload.dto.js';

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
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
    const objectKey = `${prefix.replace(/^\/+|\/+$/g, '')}/${randomUUID()}.${extensionByType[input.contentType]}`;
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: input.contentType,
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
}
