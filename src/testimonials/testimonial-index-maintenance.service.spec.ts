import type { Model } from 'mongoose';
import {
  LEGACY_TESTIMONIAL_INDEX,
  TestimonialIndexMaintenanceService,
} from './testimonial-index-maintenance.service.js';
import type { TestimonialDocument } from './schemas/testimonial.schema.js';

function createModel(indexNames: string[]) {
  const dropIndex = vi.fn().mockResolvedValue(undefined);
  const createIndexes = vi.fn().mockResolvedValue(undefined);
  const model = {
    collection: {
      listIndexes: () => ({ toArray: vi.fn().mockResolvedValue(indexNames.map((name) => ({ name }))) }),
      dropIndex,
    },
    createIndexes,
  } as unknown as Model<TestimonialDocument>;

  return { model, dropIndex, createIndexes };
}

describe('TestimonialIndexMaintenanceService', () => {
  it('removes the legacy parallel-array index and ensures current indexes', async () => {
    const { model, dropIndex, createIndexes } = createModel([LEGACY_TESTIMONIAL_INDEX]);
    const service = new TestimonialIndexMaintenanceService(model);

    await service.onApplicationBootstrap();

    expect(dropIndex).toHaveBeenCalledWith(LEGACY_TESTIMONIAL_INDEX);
    expect(createIndexes).toHaveBeenCalledOnce();
  });

  it('does not try to drop an index that is already absent', async () => {
    const { model, dropIndex, createIndexes } = createModel(['_id_']);
    const service = new TestimonialIndexMaintenanceService(model);

    await service.onApplicationBootstrap();

    expect(dropIndex).not.toHaveBeenCalled();
    expect(createIndexes).toHaveBeenCalledOnce();
  });
});
