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
import {
  TESTIMONIAL_CATEGORIES,
  TESTIMONIAL_PLACEMENTS,
  type TestimonialCategory,
  type TestimonialPlacement,
  type TestimonialStatus,
} from '../schemas/testimonial.schema.js';

const placements: TestimonialPlacement[] = [...TESTIMONIAL_PLACEMENTS];
const categories: TestimonialCategory[] = [...TESTIMONIAL_CATEGORIES];
const statuses: TestimonialStatus[] = ['draft', 'published', 'archived'];

export class UpdateTestimonialDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Matches(/\S/, { message: 'Title must contain non-whitespace characters' })
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  @Matches(/\S/, { message: 'Alt text must contain non-whitespace characters' })
  altText?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2048)
  @Matches(/^(?:\/(?!\/)|https:\/\/)/, { message: 'Image URL must be a same-origin path or HTTPS URL' })
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  objectKey?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(placements.length)
  @IsIn(placements, { each: true })
  placements?: TestimonialPlacement[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(categories.length)
  @IsIn(categories, { each: true })
  categories?: TestimonialCategory[];

  @IsOptional()
  @IsIn(statuses)
  status?: TestimonialStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}
