import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type PaymentWebhookEventDocument = HydratedDocument<PaymentWebhookEvent>;

@Schema({ timestamps: true, collection: 'payment_webhook_events' })
export class PaymentWebhookEvent {
  @Prop({ type: String, required: true, unique: true, index: true })
  providerEventId: string;

  @Prop({ type: String, required: true, index: true })
  eventType: string;

  @Prop({ type: String, required: true })
  payloadHash: string;

  @Prop({ type: String, sparse: true, index: true })
  razorpayOrderId?: string;

  @Prop({ type: String, sparse: true, index: true })
  razorpayPaymentId?: string;

  @Prop({ type: Date, required: true, default: Date.now })
  processedAt: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PaymentWebhookEventSchema = SchemaFactory.createForClass(PaymentWebhookEvent);
