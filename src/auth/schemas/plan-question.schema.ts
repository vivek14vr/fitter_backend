import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { PlanQuestionType } from '../plan-question-type.enum.js';

@Schema({ _id: false })
export class PlanQuestion {
  @Prop({ type: String, required: true, trim: true })
  id: string;

  @Prop({ type: String, required: true, trim: true })
  label: string;

  @Prop({ type: String, required: true, enum: Object.values(PlanQuestionType) })
  type: PlanQuestionType;

  @Prop({ type: Boolean, required: true, default: true })
  required: boolean;

  @Prop({ type: String, trim: true })
  helpText?: string;

  @Prop({ type: String, trim: true })
  unit?: string;

  @Prop({ type: [String], default: undefined })
  options?: string[];

  @Prop({ type: Number, required: true, min: 1, max: 24, default: 1 })
  repeatPerDay: number;
}

export const PlanQuestionSchema = SchemaFactory.createForClass(PlanQuestion);
