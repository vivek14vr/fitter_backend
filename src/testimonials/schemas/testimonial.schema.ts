import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type TestimonialDocument = HydratedDocument<Testimonial>;
export const TESTIMONIAL_PLACEMENTS = ['homepage', 'slides', 'testimonials'] as const;
export type TestimonialPlacement = (typeof TESTIMONIAL_PLACEMENTS)[number];
export const TESTIMONIAL_CATEGORIES = [
  'gut',
  'liver',
  'weight-metabolic',
  'skin',
  'hormones-thyroid',
  'mood-focus',
] as const;
export type TestimonialCategory = (typeof TESTIMONIAL_CATEGORIES)[number];
export type TestimonialStatus = 'draft' | 'published' | 'archived';

@Schema({ timestamps: true, collection: 'testimonials' })
export class Testimonial {
  @Prop({ type: String, required: true, trim: true, maxlength: 160 })
  title: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 300 })
  altText: string;

  /** Public S3/CloudFront URL or a same-origin path while content is staged. */
  @Prop({ type: String, required: true, trim: true, maxlength: 2048 })
  imageUrl: string;

  /** Stored separately so an S3 object can be replaced or removed later. */
  @Prop({ type: String, trim: true, maxlength: 512 })
  objectKey?: string;

  @Prop({
    type: [String],
    required: true,
    enum: [...TESTIMONIAL_PLACEMENTS],
    default: ['testimonials'],
  })
  placements: TestimonialPlacement[];

  @Prop({
    type: [String],
    enum: [...TESTIMONIAL_CATEGORIES],
    default: [],
  })
  categories: TestimonialCategory[];

  @Prop({
    type: String,
    required: true,
    enum: ['draft', 'published', 'archived'],
    default: 'draft',
    index: true,
  })
  status: TestimonialStatus;

  @Prop({ type: Number, required: true, default: 0, min: 0, max: 9999 })
  sortOrder: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const TestimonialSchema = SchemaFactory.createForClass(Testimonial);

// MongoDB cannot build a compound multikey index over two array fields.
// Keep placement and category filtering in separate indexes instead of
// combining the two arrays into one invalid index.
TestimonialSchema.index({ status: 1, placements: 1, sortOrder: 1, createdAt: -1 });
TestimonialSchema.index({ status: 1, categories: 1, sortOrder: 1, createdAt: -1 });
