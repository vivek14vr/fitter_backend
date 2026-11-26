import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type HealthGoalEnquiryDocument = HydratedDocument<HealthGoalEnquiry>;

@Schema({ timestamps: true, collection: 'health_goal_enquiries' })
export class HealthGoalEnquiry {
  @Prop({ type: String, sparse: true, unique: true, index: true })
  leadId?: string;

  @Prop({ type: [String], default: [] })
  concerns?: string[];

  @Prop({ type: String, trim: true, maxlength: 120 })
  goal?: string;

  @Prop({ type: String, trim: true, maxlength: 60 })
  timeline?: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 80 })
  country: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({ type: String, required: true, trim: true, lowercase: true, maxlength: 160 })
  email: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 25 })
  phone: string;

  @Prop({ type: Boolean, required: true })
  consent: boolean;

  @Prop({ type: Date, required: true })
  consentedAt: Date;

  @Prop({ type: String, required: true, default: 'homepage-health-goal-popup' })
  source: string;

  @Prop({ type: String, required: true, enum: ['health_checkin', 'consultation_booking'], default: 'health_checkin' })
  leadType: 'health_checkin' | 'consultation_booking';

  @Prop({ type: String, required: true, default: '2026-11-20' })
  privacyVersion: string;

  @Prop({ type: String, required: true, default: 'new', index: true })
  status: 'new' | 'contacted' | 'closed';

  @Prop({ type: String, enum: ['india', 'worldwide'] })
  region?: 'india' | 'worldwide';

  @Prop({ type: String, enum: ['not_required', 'pending', 'paid', 'failed'] })
  paymentStatus?: 'not_required' | 'pending' | 'paid' | 'failed';

  @Prop({ type: Number })
  paymentAmountInr?: number;

  @Prop({ type: String, enum: ['INR'] })
  paymentCurrency?: 'INR';

  @Prop({ type: Date })
  bookingLinkReleasedAt?: Date;

  @Prop({ type: String, sparse: true, index: true })
  razorpayOrderId?: string;

  @Prop({ type: String, sparse: true, unique: true })
  razorpayPaymentId?: string;

  @Prop({ type: Date })
  paymentPaidAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const HealthGoalEnquirySchema = SchemaFactory.createForClass(HealthGoalEnquiry);

HealthGoalEnquirySchema.index({ createdAt: -1 });
HealthGoalEnquirySchema.index({ status: 1, createdAt: -1 });
