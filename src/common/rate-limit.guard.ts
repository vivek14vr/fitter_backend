import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import type { Request } from 'express';
import type { Model } from 'mongoose';
import { RATE_LIMIT_KEY } from './rate-limit.decorator.js';
import type { RateLimitOptions } from './rate-limit.decorator.js';
import {
  RateLimitBucket,
  type RateLimitBucketDocument,
} from './schemas/rate-limit-bucket.schema.js';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectModel(RateLimitBucket.name)
    private readonly bucketModel: Model<RateLimitBucketDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>();
    const now = Date.now();
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    const key = `${context.getClass().name}:${context.getHandler().name}:${ip}`;
    const nowDate = new Date(now);
    const resetAt = new Date(now + options.windowMs);
    const isExpired = { $lte: [{ $ifNull: ['$resetAt', nowDate] }, nowDate] };

    const bucket = await this.bucketModel.findOneAndUpdate(
      { key },
      [
        {
          $set: {
            resetAt: { $cond: [isExpired, resetAt, '$resetAt'] },
            count: {
              $cond: [
                isExpired,
                1,
                { $add: [{ $ifNull: ['$count', 0] }, 1] },
              ],
            },
          },
        },
      ],
      // Mongoose requires this explicit opt-in for aggregation-pipeline updates.
      { new: true, upsert: true, updatePipeline: true },
    ).exec();

    if (!bucket) {
      throw new HttpException('Rate limit service is unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const remaining = Math.max(0, options.limit - bucket.count);
    response.setHeader('RateLimit-Limit', String(options.limit));
    response.setHeader('RateLimit-Remaining', String(remaining));
    response.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt.getTime() / 1000)));

    if (bucket.count > options.limit) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt.getTime() - now) / 1000))));
      throw new HttpException(
        'Too many requests. Please try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
