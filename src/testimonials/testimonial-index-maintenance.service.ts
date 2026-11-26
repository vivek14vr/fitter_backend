import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Testimonial, type TestimonialDocument } from './schemas/testimonial.schema.js';

export const LEGACY_TESTIMONIAL_INDEX =
  'status_1_placements_1_categories_1_sortOrder_1_createdAt_-1';

@Injectable()
export class TestimonialIndexMaintenanceService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TestimonialIndexMaintenanceService.name);

  constructor(
    @InjectModel(Testimonial.name)
    private readonly testimonialModel: Model<TestimonialDocument>,
  ) {}

  async onApplicationBootstrap() {
    try {
      const indexes = await this.testimonialModel.collection.listIndexes().toArray();
      if (indexes.some((index) => index.name === LEGACY_TESTIMONIAL_INDEX)) {
        await this.testimonialModel.collection.dropIndex(LEGACY_TESTIMONIAL_INDEX);
        this.logger.log(JSON.stringify({
          event: 'testimonial.legacy_index_removed',
          index: LEGACY_TESTIMONIAL_INDEX,
        }));
      }

      await this.testimonialModel.createIndexes();
      this.logger.log(JSON.stringify({ event: 'testimonial.indexes_ready' }));
    } catch (error) {
      this.logger.error(JSON.stringify({
        event: 'testimonial.index_migration_failed',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
    }
  }
}
