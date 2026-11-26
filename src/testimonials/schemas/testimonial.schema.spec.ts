import { TestimonialSchema } from './testimonial.schema.js';

describe('TestimonialSchema indexes', () => {
  it('does not create a compound index over both array fields', () => {
    const indexedFields = TestimonialSchema.indexes().map(([keys]) => Object.keys(keys));

    expect(indexedFields).toContainEqual(['status', 'placements', 'sortOrder', 'createdAt']);
    expect(indexedFields).toContainEqual(['status', 'categories', 'sortOrder', 'createdAt']);
    expect(indexedFields.some((fields) => fields.includes('placements') && fields.includes('categories'))).toBe(false);
  });
});
