import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type RateLimitBucketDocument = HydratedDocument<RateLimitBucket>;

/** A Mongo-backed bucket keeps limits consistent when the API is scaled. */
@Schema({ collection: 'rate_limit_buckets', versionKey: false })
export class RateLimitBucket {
  @Prop({ type: String, required: true, unique: true, index: true })
  key: string;

  @Prop({ type: Number, required: true, default: 0 })
  count: number;

  @Prop({ type: Date, required: true, index: true, expires: 0 })
  resetAt: Date;
}

export const RateLimitBucketSchema = SchemaFactory.createForClass(RateLimitBucket);
