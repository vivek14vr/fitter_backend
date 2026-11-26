import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { UserRole } from '../user-role.enum.js';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  })
  email: string;

  @Prop({ type: String, required: true, select: false })
  passwordHash: string;

  @Prop({
    type: String,
    required: true,
    enum: UserRole,
    default: UserRole.User,
    index: true,
  })
  role: UserRole;

  @Prop({ type: String, trim: true, default: null, index: true })
  nutritionistId: string | null;

  @Prop({ type: String, trim: true, default: null, index: true })
  planId: string | null;

  @Prop({ type: Boolean, default: true, index: true })
  dashboardUnlocked: boolean;

  @Prop({ type: Number, default: 0, min: 0 })
  authVersion: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ role: 1, createdAt: -1 });
UserSchema.index({ role: 1, name: 1 });
