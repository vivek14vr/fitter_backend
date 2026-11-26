import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { TestimonialPlacement, TestimonialStatus } from '../schemas/testimonial.schema.js';

const placements: TestimonialPlacement[] = ['homepage', 'testimonials'];
const statuses: TestimonialStatus[] = ['draft', 'published', 'archived'];

export class CreateTestimonialDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title: string;

  @IsString()
  @MinLength(5)
  @MaxLength(300)
  altText: string;

  @IsString()
  @MinLength(2)
  @MaxLength(2048)
  @Matches(/^(?:\/(?!\/)|https:\/\/)/, { message: 'Image URL must be a same-origin path or HTTPS URL' })
  imageUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  objectKey?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsIn(placements, { each: true })
  placements: TestimonialPlacement[];

  @IsOptional()
  @IsIn(statuses)
  status?: TestimonialStatus;

  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder: number;
}
