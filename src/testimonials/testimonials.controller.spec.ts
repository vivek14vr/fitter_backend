import { BadRequestException } from '@nestjs/common';
import { TestimonialsController } from './testimonials.controller.js';
import type { TestimonialsService } from './testimonials.service.js';

describe('TestimonialsController public listing', () => {
  it('accepts multiple placements and a bounded limit', async () => {
    const listPublic = vi.fn().mockResolvedValue({ testimonials: [] });
    const controller = new TestimonialsController({ listPublic } as unknown as TestimonialsService);

    await controller.list('slides,testimonials', 'gut', '4');

    expect(listPublic).toHaveBeenCalledWith(['slides', 'testimonials'], 'gut', 4, 0);
  });

  it('rejects unsupported placements', async () => {
    const listPublic = vi.fn();
    const controller = new TestimonialsController({ listPublic } as unknown as TestimonialsService);

    expect(() => controller.list('unknown', undefined, undefined)).toThrow(BadRequestException);
    expect(listPublic).not.toHaveBeenCalled();
  });

  it('accepts the uncategorized filter without changing valid programme categories', async () => {
    const listPublic = vi.fn().mockResolvedValue({ testimonials: [] });
    const controller = new TestimonialsController({ listPublic } as unknown as TestimonialsService);

    await controller.list('homepage', 'general', '4');

    expect(listPublic).toHaveBeenCalledWith(['homepage'], 'general', 4, 0);
  });

  it('accepts a page offset and rejects invalid offsets', async () => {
    const listPublic = vi.fn().mockResolvedValue({ testimonials: [] });
    const controller = new TestimonialsController({ listPublic } as unknown as TestimonialsService);
    await controller.list('slides', 'gut', '24', '24');
    expect(listPublic).toHaveBeenCalledWith(['slides'], 'gut', 24, 24);
    expect(() => controller.list('slides', 'gut', '24', '-1')).toThrow(BadRequestException);
    expect(() => controller.list('slides', 'gut', '24', ['0', '24'])).toThrow(BadRequestException);
  });

  it.each([
    { category: ['gut', 'liver'], limit: '4' },
    { category: 'gut', limit: ['2', '4'] },
    { category: { value: 'gut' }, limit: '4' },
    { category: 'gut', limit: { value: '4' } },
  ])('rejects non-scalar category or limit query values', ({ category, limit }) => {
    const listPublic = vi.fn();
    const controller = new TestimonialsController({ listPublic } as unknown as TestimonialsService);

    expect(() => controller.list('slides', category, limit)).toThrow(BadRequestException);
    expect(listPublic).not.toHaveBeenCalled();
  });
});
