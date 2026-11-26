import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { PlanQuestion, PlanQuestionSchema } from './plan-question.schema.js';

export type PlanDocument = HydratedDocument<Plan>;

@Schema({ timestamps: true, collection: 'plans' })
export class Plan {
  @Prop({ type: String, required: true, unique: true, trim: true })
  name: string;

  @Prop({ type: String, required: true, trim: true })
  description: string;

  @Prop({ type: Number, required: true, min: 1, max: 3650, default: 30, index: true })
  durationDays: number;

  @Prop({ type: Number, required: true, min: 1, max: 3650, default: 30, index: true })
  validityDays: number;

  @Prop({ type: Number, required: true, min: 1, max: 3650, default: 30, index: true })
  formFillingDays: number;

  @Prop({ type: [PlanQuestionSchema], required: true, default: [] })
  questions: PlanQuestion[];

  @Prop({ type: Boolean, required: true, default: true, index: true })
  active: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PlanSchema = SchemaFactory.createForClass(Plan);

PlanSchema.index({ active: 1, name: 1 });
