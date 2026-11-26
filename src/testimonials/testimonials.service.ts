import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
  constructor(
    @InjectModel(Testimonial.name)
    private readonly testimonialModel: Model<TestimonialDocument>,
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
    const testimonial = await this.testimonialModel.create({
      title: dto.title.trim(),
      altText: dto.altText.trim(),
      imageUrl: normalizeImageUrl(dto.imageUrl),
      objectKey: dto.objectKey?.trim() || undefined,
      placements: normalizePlacements(dto.placements),
      status: dto.status ?? 'draft',
      sortOrder: dto.sortOrder,
    });
    return this.present(testimonial);
  }

  async update(id: string, dto: UpdateTestimonialDto) {
    const testimonial = await this.findById(id);
    if (dto.placements && !dto.placements.length) {
      throw new BadRequestException('Choose at least one display section');
    }

    if (dto.title !== undefined) testimonial.title = dto.title.trim();
    if (dto.altText !== undefined) testimonial.altText = dto.altText.trim();
    if (dto.imageUrl !== undefined) testimonial.imageUrl = normalizeImageUrl(dto.imageUrl);
    if (dto.objectKey !== undefined) testimonial.objectKey = dto.objectKey.trim() || undefined;
    if (dto.placements !== undefined) testimonial.placements = normalizePlacements(dto.placements);
    if (dto.status !== undefined) testimonial.status = dto.status;
    if (dto.sortOrder !== undefined) testimonial.sortOrder = dto.sortOrder;
    await testimonial.save();
    return this.present(testimonial);
  }

  async archive(id: string) {
    const testimonial = await this.findById(id);
    testimonial.status = 'archived';
    await testimonial.save();
    return this.present(testimonial);
  }

  private async findById(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid testimonial id');
    const testimonial = await this.testimonialModel.findById(id).exec();
    if (!testimonial) throw new NotFoundException('Testimonial not found');
    return testimonial;
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
