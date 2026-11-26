import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type LeadDocument = HydratedDocument<Lead>;

export type LeadStatus =
  | 'in_progress'
  | 'submitted'
  | 'payment_pending'
  | 'payment_failed'
  | 'paid'
  | 'contacted'
  | 'closed';

export type LeadFollowUpStatus = 'new' | 'contacted' | 'closed';
export type LeadRegion = 'india' | 'worldwide';
export type LeadPaymentStatus = 'not_required' | 'pending' | 'order_created' | 'paid' | 'failed';

@Schema({ timestamps: true, collection: 'leads' })
export class Lead {
  @Prop({ type: String, required: true, default: 'homepage-health-goal-popup', index: true })
  source: 'homepage-health-goal-popup' | 'one-to-one-booking-popup';

  @Prop({ type: String, required: true, enum: ['health_checkin', 'consultation_booking'], default: 'health_checkin', index: true })
  leadType: 'health_checkin' | 'consultation_booking';

  /**
   * A hashed browser-held capability. It protects public continuation calls
   * without exposing a reusable secret through an ObjectId alone.
   */
  @Prop({ type: String, required: true, unique: true, select: false })
  continuationTokenHash: string;

  @Prop({ type: String, required: true, unique: true, select: false })
  idempotencyKeyHash: string;

  @Prop({ type: [String] })
  concerns?: string[];

  @Prop({ type: String, trim: true, maxlength: 120 })
  goal?: string;

  @Prop({ type: String, trim: true, maxlength: 60 })
  timeline?: string;

  @Prop({ type: String, trim: true, maxlength: 80 })
  country?: string;

  @Prop({ type: String, trim: true, maxlength: 5 })
  countryCode?: string;

  @Prop({ type: String, trim: true, maxlength: 100 })
  name?: string;

  @Prop({ type: String, trim: true, lowercase: true, maxlength: 160 })
  email?: string;

  @Prop({ type: String, trim: true, maxlength: 25 })
  phone?: string;

  @Prop({ type: Boolean })
  consent?: boolean;

  @Prop({ type: Date })
  consentedAt?: Date;

  @Prop({ type: String, required: true, default: '2026-11-26' })
  privacyVersion: string;

  @Prop({ type: Number, required: true, default: 0 })
  completedStep: number;

  @Prop({
    type: String,
    required: true,
    enum: ['in_progress', 'submitted', 'payment_pending', 'payment_failed', 'paid', 'contacted', 'closed'],
    default: 'in_progress',
    index: true,
  })
  status: LeadStatus;

  @Prop({ type: String, enum: ['new', 'contacted', 'closed'], default: 'new', index: true })
  followUpStatus: LeadFollowUpStatus;

  @Prop({ type: String, enum: ['india', 'worldwide'] })
  region?: LeadRegion;

  @Prop({
    type: String,
    enum: ['not_required', 'pending', 'order_created', 'paid', 'failed'],
  })
  paymentStatus?: LeadPaymentStatus;

  @Prop({ type: Number })
  paymentAmountInr?: number;

  @Prop({ type: String, enum: ['INR'] })
  paymentCurrency?: 'INR';

  @Prop({ type: String, sparse: true, index: true })
  razorpayOrderId?: string;

  @Prop({ type: String, sparse: true, unique: true })
  razorpayPaymentId?: string;

  @Prop({ type: Date })
  paymentPaidAt?: Date;

  @Prop({ type: String })
  bookingLink?: string;

  @Prop({ type: Date })
  bookingLinkReleasedAt?: Date;

  @Prop({ type: String, sparse: true, unique: true, index: true })
  consultationId?: string;

  @Prop({ type: Date })
  submittedAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const LeadSchema = SchemaFactory.createForClass(Lead);

LeadSchema.index({ createdAt: -1 });
LeadSchema.index({ email: 1, createdAt: -1 });
LeadSchema.index({ status: 1, createdAt: -1 });
LeadSchema.index({ followUpStatus: 1, createdAt: -1 });
LeadSchema.index({ leadType: 1, createdAt: -1 });
