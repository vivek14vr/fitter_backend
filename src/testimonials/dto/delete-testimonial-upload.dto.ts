import { IsString, MaxLength, MinLength } from 'class-validator';

export class DeleteTestimonialUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  objectKey: string;
}
