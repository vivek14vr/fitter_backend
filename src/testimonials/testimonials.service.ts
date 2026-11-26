import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { CreateTestimonialDto } from './dto/create-testimonial.dto.js';
import { UpdateTestimonialDto } from './dto/update-testimonial.dto.js';
import {
  Testimonial,
  type TestimonialDocument,
  type TestimonialPlacement,
} from './schemas/testimonial.schema.js';
import { TestimonialStorageService } from './testimonial-storage.service.js';

function normalizeImageUrl(value: string) {
  const imageUrl = value.trim();
  if (/^\/(?!\/)/.test(imageUrl)) return imageUrl;

  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== 'https:') throw new Error('Image URL must use HTTPS');
    return imageUrl;
  } catch {
    throw new BadRequestException('Image URL must be a same-origin path or HTTPS URL');
  }
}

function normalizePlacements(placements: TestimonialPlacement[]) {
  const unique = [...new Set(placements)];
  if (!unique.length) throw new BadRequestException('Choose at least one display section');
  return unique;
}

@Injectable()
export class TestimonialsService {
  private readonly logger = new Logger(TestimonialsService.name);

  constructor(
    @InjectModel(Testimonial.name)
    private readonly testimonialModel: Model<TestimonialDocument>,
    private readonly storageService: TestimonialStorageService,
  ) {}

  async listPublic(placement: TestimonialPlacement) {
    const testimonials = await this.testimonialModel
      .find({ status: 'published', placements: placement })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean()
      .exec();
    return { testimonials: testimonials.map((testimonial) => this.present(testimonial)) };
  }

  async listAdmin() {
    const testimonials = await this.testimonialModel
      .find()
      .sort({ status: 1, sortOrder: 1, createdAt: -1 })
      .lean()
      .exec();
    return { testimonials: testimonials.map((testimonial) => this.present(testimonial)) };
  }

  async create(dto: CreateTestimonialDto) {
    const requestedObjectKey = dto.objectKey?.trim() || undefined;
    const promotedObject = requestedObjectKey
      ? await this.storageService.promoteObject(requestedObjectKey)
      : undefined;
    const objectKey = promotedObject?.objectKey ?? requestedObjectKey;
    const imageUrl = promotedObject?.publicUrl ?? normalizeImageUrl(dto.imageUrl);

    try {
      const testimonial = await this.testimonialModel.create({
        title: dto.title.trim(),
        altText: dto.altText.trim(),
        imageUrl,
        objectKey,
        placements: normalizePlacements(dto.placements),
        status: dto.status ?? 'draft',
        sortOrder: dto.sortOrder,
      });
      return this.present(testimonial);
    } catch (error) {
      if (objectKey) await this.cleanupObjectIfUnreferenced(objectKey);
      throw error;
    }
  }

  async update(id: string, dto: UpdateTestimonialDto) {
    const testimonial = await this.findById(id);
    if (dto.placements && !dto.placements.length) {
      throw new BadRequestException('Choose at least one display section');
    }

    const previousObjectKey = testimonial.objectKey;
    const requestedObjectKey = dto.objectKey === undefined
      ? previousObjectKey
      : dto.objectKey.trim() || undefined;
    const promotedObject = requestedObjectKey && requestedObjectKey !== previousObjectKey
      ? await this.storageService.promoteObject(requestedObjectKey)
      : undefined;
    const nextObjectKey = promotedObject?.objectKey ?? requestedObjectKey;

    if (dto.title !== undefined) testimonial.title = dto.title.trim();
    if (dto.altText !== undefined) testimonial.altText = dto.altText.trim();
    if (promotedObject) testimonial.imageUrl = promotedObject.publicUrl;
    else if (dto.imageUrl !== undefined) testimonial.imageUrl = normalizeImageUrl(dto.imageUrl);
    if (dto.objectKey !== undefined) testimonial.objectKey = nextObjectKey;
    if (dto.placements !== undefined) testimonial.placements = normalizePlacements(dto.placements);
    if (dto.status !== undefined) testimonial.status = dto.status;
    if (dto.sortOrder !== undefined) testimonial.sortOrder = dto.sortOrder;
    try {
      await testimonial.save();
    } catch (error) {
      if (nextObjectKey && nextObjectKey !== previousObjectKey) {
        await this.cleanupObjectIfUnreferenced(nextObjectKey);
      }
      throw error;
    }

    if (previousObjectKey && previousObjectKey !== testimonial.objectKey) {
      await this.cleanupObjectIfUnreferenced(previousObjectKey, testimonial._id.toString());
    }

    return this.present(testimonial);
  }

  async archive(id: string) {
    const testimonial = await this.findById(id);
    testimonial.status = 'archived';
    await testimonial.save();
    return this.present(testimonial);
  }

  async discardUpload(objectKey: string) {
    const normalizedObjectKey = objectKey.trim();
    if (!normalizedObjectKey) throw new BadRequestException('Invalid testimonial storage object key');

    const references = await this.testimonialModel.countDocuments({ objectKey: normalizedObjectKey }).exec();
    if (references > 0) return { deleted: false, reason: 'in_use' as const };

    await this.storageService.deleteObject(normalizedObjectKey);
    return { deleted: true as const };
  }

  private async findById(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid testimonial id');
    const testimonial = await this.testimonialModel.findById(id).exec();
    if (!testimonial) throw new NotFoundException('Testimonial not found');
    return testimonial;
  }

  private async cleanupObjectIfUnreferenced(objectKey: string, excludedId?: string) {
    try {
      const query: Record<string, unknown> = { objectKey };
      if (excludedId) query._id = { $ne: excludedId };
      const references = await this.testimonialModel.countDocuments(query).exec();
      if (references === 0) await this.storageService.deleteObject(objectKey);
    } catch (error) {
      this.logger.warn(JSON.stringify({
        event: 'testimonial.storage.cleanup_failed',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
    }
  }

  private present(testimonial: Pick<TestimonialDocument, '_id' | 'title' | 'altText' | 'imageUrl' | 'objectKey' | 'placements' | 'status' | 'sortOrder' | 'createdAt' | 'updatedAt'>) {
    return {
      id: testimonial._id.toString(),
      title: testimonial.title,
      altText: testimonial.altText,
      imageUrl: testimonial.imageUrl,
      objectKey: testimonial.objectKey ?? null,
      placements: testimonial.placements,
      status: testimonial.status,
      sortOrder: testimonial.sortOrder,
      createdAt: testimonial.createdAt ?? null,
      updatedAt: testimonial.updatedAt ?? null,
    };
  }
}
