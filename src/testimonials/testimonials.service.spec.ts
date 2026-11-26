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
});
