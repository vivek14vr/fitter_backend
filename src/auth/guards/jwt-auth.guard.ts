import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import type { Model } from 'mongoose';
import type { AuthPayload, AuthenticatedRequest } from '../auth.types.js';
import {
  AuthSession,
  AuthSessionDocument,
} from '../schemas/auth-session.schema.js';
import { User } from '../schemas/user.schema.js';
import type { UserDocument } from '../schemas/user.schema.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    @InjectModel(AuthSession.name)
    private readonly sessionModel: Model<AuthSessionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      this.logger.warn(JSON.stringify({
        event: 'auth.guard.rejected',
        reason: 'missing_bearer_token',
        path: request.path,
      }));
      throw new UnauthorizedException('Bearer token required');
    }

    try {
      const token = authorization.slice(7);
      const payload = await this.jwtService.verifyAsync<AuthPayload>(
        token,
      );
      const tokenHash = createHash('sha256').update(token).digest('hex');

      const session = await this.sessionModel
        .findOne({
          userId: payload.sub,
          jti: payload.jti,
          tokenHash,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        })
        .lean()
        .exec();

      const user = await this.userModel.findById(payload.sub).lean().exec();

      if (
        !session
        || !user
        || user.role !== payload.role
        || (user.authVersion ?? 0) !== (payload.authVersion ?? 0)
      ) {
        throw new UnauthorizedException('Session is no longer active');
      }

      request.user = {
        ...payload,
        email: user.email,
        name: user.name,
        role: user.role,
        dashboardUnlocked: user.dashboardUnlocked !== false,
      };
      return true;
    } catch {
      this.logger.warn(JSON.stringify({
        event: 'auth.guard.rejected',
        reason: 'invalid_or_expired_token',
        path: request.path,
      }));
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
