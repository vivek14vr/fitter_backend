import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { AdminController } from '../admin/admin.controller.js';
import { NutritionistController } from '../nutritionist/nutritionist.controller.js';
import { UserController } from '../user/user.controller.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { WorkspaceAccessGuard } from './guards/workspace-access.guard.js';
import { RateLimitGuard } from '../common/rate-limit.guard.js';
import {
  AuthSession,
  AuthSessionSchema,
} from './schemas/auth-session.schema.js';
import { Plan, PlanSchema } from './schemas/plan.schema.js';
import { PlanInstance, PlanInstanceSchema } from './schemas/plan-instance.schema.js';
import { User, UserSchema } from './schemas/user.schema.js';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema.js';
import {
  RateLimitBucket,
  RateLimitBucketSchema,
} from '../common/schemas/rate-limit-bucket.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AuthSession.name, schema: AuthSessionSchema },
      { name: Plan.name, schema: PlanSchema },
      { name: PlanInstance.name, schema: PlanInstanceSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: RateLimitBucket.name, schema: RateLimitBucketSchema },
    ]),
    JwtModule.registerAsync({
      useFactory: () => {
        const configuredSecret = process.env.JWT_SECRET?.trim();
        if (!configuredSecret && process.env.NODE_ENV === 'production') {
          throw new Error('JWT_SECRET must be configured in production');
        }

        const secret = configuredSecret ?? randomBytes(64).toString('hex');
        return {
          secret,
          signOptions: { expiresIn: '1d' },
        };
      },
    }),
  ],
  controllers: [
    AuthController,
    AdminController,
    NutritionistController,
    UserController,
  ],
  providers: [AuthService, JwtAuthGuard, RolesGuard, WorkspaceAccessGuard, RateLimitGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard, WorkspaceAccessGuard, RateLimitGuard, JwtModule],
})
export class AuthModule {}
