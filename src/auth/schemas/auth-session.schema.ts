import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type AuthSessionDocument = HydratedDocument<AuthSession>;

@Schema({ timestamps: true, collection: 'auth_sessions' })
export class AuthSession {
  @Prop({ type: String, required: true, index: true })
  userId: string;

  @Prop({ type: String, required: true, unique: true, index: true })
  jti: string;

  @Prop({
    type: String,
    required: true,
    unique: true,
    index: true,
    select: false,
  })
  tokenHash: string;

  @Prop({
    type: String,
    required: true,
    unique: true,
    index: true,
    sparse: true,
    select: false,
  })
  refreshTokenHash: string;

  // This is the lifetime of the refresh session. Access-token expiry is
  // enforced by JWT verification and is intentionally much shorter.
  @Prop({ required: true, type: Date, index: true, expires: 0 })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  revokedAt: Date | null;
}

export const AuthSessionSchema = SchemaFactory.createForClass(AuthSession);
