import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTestimonialDto } from './create-testimonial.dto.js';
import { UpdateTestimonialDto } from './update-testimonial.dto.js';

const validPayload = {
  title: 'A calmer relationship with food',
  altText: 'Client testimonial describing a calmer relationship with food',
  imageUrl: 'https://cdn.example.com/testimonial.webp',
  placements: ['homepage'],
  sortOrder: 0,
};

describe('Testimonial DTOs', () => {
  it('accepts a valid testimonial', async () => {
    const dto = plainToInstance(CreateTestimonialDto, validPayload);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects whitespace-only title and alt text', async () => {
    const dto = plainToInstance(CreateTestimonialDto, {
      ...validPayload,
      title: '   ',
      altText: '     ',
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['title', 'altText']));
  });

  it('rejects whitespace-only partial updates', async () => {
    const dto = plainToInstance(UpdateTestimonialDto, { title: '  ' });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('title');
  });
});
