import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type TestimonialDocument = HydratedDocument<Testimonial>;
export type TestimonialPlacement = 'homepage' | 'testimonials';
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
    enum: ['homepage', 'testimonials'],
    default: ['testimonials'],
  })
  placements: TestimonialPlacement[];

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

TestimonialSchema.index({ status: 1, placements: 1, sortOrder: 1, createdAt: -1 });
