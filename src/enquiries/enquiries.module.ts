import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import {
  RateLimitBucket,
  RateLimitBucketSchema,
} from '../common/schemas/rate-limit-bucket.schema.js';
import {
  AuthSession,
  AuthSessionSchema,
} from '../auth/schemas/auth-session.schema.js';
import { User, UserSchema } from '../auth/schemas/user.schema.js';
import { AuditLog, AuditLogSchema } from '../auth/schemas/audit-log.schema.js';
import {
  AdminHealthGoalEnquiriesController,
  HealthGoalEnquiriesController,
} from './health-goal-enquiries.controller.js';
import { ContactEnquiriesController } from './contact-enquiries.controller.js';
import { ConsultationsController } from './consultations.controller.js';
import { AdminLeadsController, LeadsController } from './leads.controller.js';
import { PaymentWebhookController } from './payment-webhook.controller.js';
import { LeadProgressService } from './lead-progress.service.js';
import { RazorpayService } from './razorpay.service.js';
import {
  ContactEnquiry,
  ContactEnquirySchema,
} from './schemas/contact-enquiry.schema.js';
import {
  HealthGoalEnquiry,
  HealthGoalEnquirySchema,
} from './schemas/health-goal-enquiry.schema.js';
import { Lead, LeadSchema } from './schemas/lead.schema.js';
import {
  PaymentWebhookEvent,
  PaymentWebhookEventSchema,
} from './schemas/payment-webhook-event.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HealthGoalEnquiry.name, schema: HealthGoalEnquirySchema },
      { name: ContactEnquiry.name, schema: ContactEnquirySchema },
      { name: AuthSession.name, schema: AuthSessionSchema },
      { name: User.name, schema: UserSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: PaymentWebhookEvent.name, schema: PaymentWebhookEventSchema },
      // The public controllers resolve RateLimitGuard in this module's context.
      { name: RateLimitBucket.name, schema: RateLimitBucketSchema },
    ]),
    AuthModule,
  ],
  controllers: [
    HealthGoalEnquiriesController,
    AdminHealthGoalEnquiriesController,
    ContactEnquiriesController,
    ConsultationsController,
    LeadsController,
    AdminLeadsController,
    PaymentWebhookController,
  ],
  providers: [LeadProgressService, RazorpayService],
})
export class EnquiriesModule {}
