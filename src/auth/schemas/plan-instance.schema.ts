import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { PlanInstanceStatus } from '../plan-instance-status.enum.js';
import { PlanQuestion, PlanQuestionSchema } from './plan-question.schema.js';

export type PlanInstanceDocument = HydratedDocument<PlanInstance>;

@Schema({ _id: false })
export class PlanAnswer {
  @Prop({ type: String, required: true })
  questionId: string;

  @Prop({ type: String, required: true, trim: true, default: () => new Date().toISOString().slice(0, 10) })
  entryDate: string;

  @Prop({ type: Number, required: true, min: 0, max: 23, default: 0 })
  occurrence: number;

  @Prop({ type: MongooseSchema.Types.Mixed })
  value: unknown;

  @Prop({ type: Date, required: true, default: Date.now })
  answeredAt: Date;
}

export const PlanAnswerSchema = SchemaFactory.createForClass(PlanAnswer);

@Schema({ timestamps: true, collection: 'plan_instances' })
export class PlanInstance {
  @Prop({ type: String, required: true, index: true })
  templateId: string;

  @Prop({ type: String, required: true, index: true })
  userId: string;

  @Prop({ type: String, default: null, index: true })
  nutritionistId: string | null;

  @Prop({ type: String, trim: true, default: null })
  userNameSnapshot: string | null;

  @Prop({ type: String, trim: true, lowercase: true, default: null })
  userEmailSnapshot: string | null;

  @Prop({ type: String, required: true, trim: true })
  templateName: string;

  @Prop({ type: Number, required: true, min: 1, max: 3650, default: 30 })
  planValidityDays: number;

  @Prop({ type: Number, required: true, min: 1, max: 3650, default: 30 })
  formFillingDays: number;

  @Prop({ type: [PlanQuestionSchema], required: true, default: [] })
  questions: PlanQuestion[];

  @Prop({ type: [PlanAnswerSchema], required: true, default: [] })
  answers: PlanAnswer[];

  @Prop({ type: String, required: true, enum: Object.values(PlanInstanceStatus), index: true })
  status: PlanInstanceStatus;

  @Prop({ type: Date, required: true, default: Date.now, index: true })
  assignedAt: Date;

  @Prop({ type: Date, required: true, index: true })
  dueAt: Date;

  @Prop({ type: Date, required: true, index: true })
  planValidUntil: Date;

  @Prop({ type: String, trim: true })
  adminNotes?: string;

  @Prop({ type: String, trim: true })
  nutritionistNotes?: string;

  @Prop({ type: String, default: null })
  reviewedBy: string | null;

  @Prop({ type: Date, default: null })
  reviewedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PlanInstanceSchema = SchemaFactory.createForClass(PlanInstance);

PlanInstanceSchema.index({ userId: 1, status: 1, assignedAt: -1 });
PlanInstanceSchema.index({ nutritionistId: 1, status: 1, dueAt: 1 });
PlanInstanceSchema.index({ nutritionistId: 1, status: 1, reviewedAt: -1 });
PlanInstanceSchema.index({ templateId: 1, userId: 1, assignedAt: -1 });
