import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DeleteTestimonialUploadDto } from './delete-testimonial-upload.dto.js';

describe('DeleteTestimonialUploadDto', () => {
  it('requires a storage object key', async () => {
    const dto = plainToInstance(DeleteTestimonialUploadDto, { objectKey: '' });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('objectKey');
  });
});
