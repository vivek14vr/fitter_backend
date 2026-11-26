import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type ContactEnquiryDocument = HydratedDocument<ContactEnquiry>;

@Schema({ timestamps: true, collection: 'contact_enquiries' })
export class ContactEnquiry {
  @Prop({ type: String, required: true, trim: true, maxlength: 80 })
  firstName: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 80 })
  lastName: string;

  @Prop({ type: String, required: true, trim: true, lowercase: true, maxlength: 160 })
  email: string;

  @Prop({ type: String, trim: true, maxlength: 80 })
  city?: string;

  @Prop({ type: String, trim: true, maxlength: 25 })
  whatsapp?: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 2000 })
  message: string;

  @Prop({ type: Boolean, required: true })
  consent: boolean;

  @Prop({ type: Date, required: true })
  consentedAt: Date;

  @Prop({ type: String, required: true, default: 'contact-page' })
  source: string;

  @Prop({ type: String, required: true, default: 'new', index: true })
  status: 'new' | 'contacted' | 'closed';

  createdAt?: Date;
  updatedAt?: Date;
}

export const ContactEnquirySchema = SchemaFactory.createForClass(ContactEnquiry);

ContactEnquirySchema.index({ createdAt: -1 });
ContactEnquirySchema.index({ status: 1, createdAt: -1 });
