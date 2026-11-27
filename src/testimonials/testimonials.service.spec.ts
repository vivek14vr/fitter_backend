import type { Model } from 'mongoose';
import type { TestimonialDocument } from './schemas/testimonial.schema.js';
import { TestimonialStorageService } from './testimonial-storage.service.js';
import { TestimonialsService } from './testimonials.service.js';

function createService(count: number) {
  const countDocuments = vi.fn(() => ({ exec: vi.fn().mockResolvedValue(count) }));
  const deleteObject = vi.fn().mockResolvedValue(undefined);
  const model = { countDocuments } as unknown as Model<TestimonialDocument>;
  const storage = { deleteObject } as unknown as TestimonialStorageService;
  return { service: new TestimonialsService(model, storage), countDocuments, deleteObject };
}

describe('TestimonialsService upload cleanup', () => {
  it('deletes an unreferenced uploaded object', async () => {
    const { service, deleteObject } = createService(0);

    await expect(service.discardUpload('testimonials/pending.webp')).resolves.toEqual({ deleted: true });
    expect(deleteObject).toHaveBeenCalledWith('testimonials/pending.webp');
  });

  it('keeps an object that is referenced by a testimonial', async () => {
    const { service, deleteObject } = createService(1);

    await expect(service.discardUpload('testimonials/published.webp')).resolves.toEqual({ deleted: false, reason: 'in_use' });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('permanently deletes a testimonial and cleans up its image', async () => {
    const id = '507f1f77bcf86cd799439011';
    const objectId = { toString: () => id };
    const testimonial = {
      _id: objectId,
      title: 'Story',
      altText: 'Story image',
      imageUrl: 'https://stored.example/story.webp',
      objectKey: 'testimonials/story.webp',
      placements: ['testimonials'],
      categories: [],
      status: 'draft',
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as TestimonialDocument;
    const deleteOne = vi.fn(() => ({ exec: vi.fn().mockResolvedValue({ deletedCount: 1 }) }));
    const findById = vi.fn(() => ({ exec: vi.fn().mockResolvedValue(testimonial) }));
    const countDocuments = vi.fn(() => ({ exec: vi.fn().mockResolvedValue(0) }));
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const model = { findById, deleteOne, countDocuments } as unknown as Model<TestimonialDocument>;
    const storage = { deleteObject } as unknown as TestimonialStorageService;
    const service = new TestimonialsService(model, storage);

    await expect(service.remove(id)).resolves.toMatchObject({ id, title: 'Story' });
    expect(deleteOne).toHaveBeenCalledWith({ _id: objectId });
    expect(deleteObject).toHaveBeenCalledWith('testimonials/story.webp');
  });
});

describe('TestimonialsService public listing', () => {
  it('filters by any requested placement and caps the public result size', async () => {
    const id = '507f1f77bcf86cd799439011';
    const testimonial = {
      _id: { toString: () => id },
      title: 'Story',
      altText: 'Story image',
      imageUrl: 'https://stored.example/story.webp',
      objectKey: 'testimonials/story.webp',
      placements: ['slides', 'testimonials'],
      categories: ['gut'],
      status: 'published',
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as TestimonialDocument;
    const query = {
      sort: vi.fn(),
      skip: vi.fn(),
      limit: vi.fn(),
      lean: vi.fn(),
      exec: vi.fn().mockResolvedValue([testimonial]),
    };
    query.sort.mockReturnValue(query);
    query.skip.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    query.lean.mockReturnValue(query);
    const find = vi.fn().mockReturnValue(query);
    const resolveImageUrl = vi.fn().mockResolvedValue('https://cdn.example/story.webp');
    const model = { find } as unknown as Model<TestimonialDocument>;
    const storage = { resolveImageUrl } as unknown as TestimonialStorageService;
    const service = new TestimonialsService(model, storage);

    await expect(service.listPublic(['slides', 'testimonials'], 'gut', 40)).resolves.toMatchObject({
      testimonials: [{ id, imageUrl: 'https://cdn.example/story.webp' }],
    });
    expect(find).toHaveBeenCalledWith({
      status: 'published',
      placements: { $in: ['slides', 'testimonials'] },
      categories: 'gut',
    });
    expect(query.limit).toHaveBeenCalledWith(25);
    expect(resolveImageUrl).toHaveBeenCalledWith('testimonials/story.webp', 'https://stored.example/story.webp');

    query.exec.mockResolvedValueOnce(Array<TestimonialDocument>(5).fill(testimonial));
    const page = await service.listPublic(['homepage'], 'general', 4, 8);
    expect(find).toHaveBeenLastCalledWith({
      status: 'published',
      placements: { $in: ['homepage'] },
      'categories.0': { $exists: false },
    });
    expect(query.skip).toHaveBeenLastCalledWith(8);
    expect(query.limit).toHaveBeenLastCalledWith(5);
    expect(page.nextOffset).toBe(12);
    expect(page.testimonials).toHaveLength(4);
  });
});

describe('TestimonialStorageService upload signing', () => {
  const environment = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in environment)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(environment)) process.env[key] = value;
  });

  it('signs the declared content length into the upload URL', async () => {
    process.env.AWS_REGION = 'ap-south-1';
    process.env.AWS_S3_BUCKET = 'example-bucket';
    process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';

    const storage = new TestimonialStorageService();
    const upload = await storage.createUpload({ contentType: 'image/webp', fileSize: 1234 });
    const signedHeaders = new URL(upload.uploadUrl).searchParams.get('X-Amz-SignedHeaders');

    expect(signedHeaders).toContain('content-length');
  });

  it('signs a readable image URL when no public image origin is configured', async () => {
    process.env.AWS_REGION = 'ap-south-1';
    process.env.AWS_S3_BUCKET = 'example-bucket';
    process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
    delete process.env.AWS_S3_PUBLIC_BASE_URL;

    const storage = new TestimonialStorageService();
    const imageUrl = await storage.resolveImageUrl('testimonials/story.webp', 'https://stored.example/story.webp');

    expect(imageUrl).toContain('X-Amz-Signature');
    expect(new URL(imageUrl).pathname).toBe('/testimonials/story.webp');
  });

  it('does not trust a direct S3 base URL for browser reads', async () => {
    process.env.AWS_REGION = 'ap-south-1';
    process.env.AWS_S3_BUCKET = 'example-bucket';
    process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.AWS_S3_PUBLIC_BASE_URL = 'https://example-bucket.s3.ap-south-1.amazonaws.com';

    const storage = new TestimonialStorageService();
    const imageUrl = await storage.resolveImageUrl('testimonials/story.webp', 'https://stored.example/story.webp');

    expect(imageUrl).toContain('X-Amz-Signature');
  });

  it('signs legacy direct S3 fallback URLs when the record has no object key', async () => {
    process.env.AWS_REGION = 'ap-south-1';
    process.env.AWS_S3_BUCKET = 'example-bucket';
    process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
    delete process.env.AWS_S3_PUBLIC_BASE_URL;

    const storage = new TestimonialStorageService();
    const imageUrl = await storage.resolveImageUrl(
      null,
      'https://example-bucket.s3.ap-south-1.amazonaws.com/testimonials/legacy-story.webp',
    );

    expect(imageUrl).toContain('X-Amz-Signature');
    expect(new URL(imageUrl).pathname).toBe('/testimonials/legacy-story.webp');
  });
});
