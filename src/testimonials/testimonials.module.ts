import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { AuditLog, AuditLogSchema } from '../auth/schemas/audit-log.schema.js';
import { AuthSession, AuthSessionSchema } from '../auth/schemas/auth-session.schema.js';
import { User, UserSchema } from '../auth/schemas/user.schema.js';
import { Testimonial, TestimonialSchema } from './schemas/testimonial.schema.js';
import { TestimonialIndexMaintenanceService } from './testimonial-index-maintenance.service.js';
import { TestimonialStorageService } from './testimonial-storage.service.js';
import { AdminTestimonialsController, TestimonialsController } from './testimonials.controller.js';
import { TestimonialsService } from './testimonials.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Testimonial.name, schema: TestimonialSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      // JwtAuthGuard is applied at the controller level and resolves its
      // session and user models in this module's context at runtime.
      { name: AuthSession.name, schema: AuthSessionSchema },
      { name: User.name, schema: UserSchema },
    ]),
    AuthModule,
  ],
  controllers: [TestimonialsController, AdminTestimonialsController],
  providers: [TestimonialsService, TestimonialStorageService, TestimonialIndexMaintenanceService],
})
export class TestimonialsModule {}
