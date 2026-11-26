import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { AuditLog, AuditLogSchema } from '../auth/schemas/audit-log.schema.js';
import { Testimonial, TestimonialSchema } from './schemas/testimonial.schema.js';
import { TestimonialStorageService } from './testimonial-storage.service.js';
import { AdminTestimonialsController, TestimonialsController } from './testimonials.controller.js';
import { TestimonialsService } from './testimonials.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Testimonial.name, schema: TestimonialSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
    AuthModule,
  ],
  controllers: [TestimonialsController, AdminTestimonialsController],
  providers: [TestimonialsService, TestimonialStorageService],
})
export class TestimonialsModule {}
