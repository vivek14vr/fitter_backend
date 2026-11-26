import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export const TESTIMONIAL_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

export const MAX_TESTIMONIAL_IMAGE_SIZE = 10 * 1024 * 1024;

export class CreateTestimonialUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fileName: string;

  @IsString()
  @IsIn(TESTIMONIAL_IMAGE_TYPES)
  contentType: (typeof TESTIMONIAL_IMAGE_TYPES)[number];

  @IsInt()
  @Min(1)
  @Max(MAX_TESTIMONIAL_IMAGE_SIZE)
  fileSize: number;
}
