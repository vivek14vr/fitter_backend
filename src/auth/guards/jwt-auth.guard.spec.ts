import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { Model } from 'mongoose';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { AuthSessionDocument } from '../schemas/auth-session.schema.js';
import type { UserDocument } from '../schemas/user.schema.js';
import { UserRole } from '../user-role.enum.js';

describe('JwtAuthGuard auth version', () => {
  it('rejects an access token issued before the user was approved', async () => {
    const verifyAsync = vi.fn().mockResolvedValue({
      sub: 'user-1',
      jti: 'session-1',
      email: 'user@example.com',
      name: 'Test User',
      role: UserRole.User,
      authVersion: 0,
    });
    const sessionModel = {
      findOne: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue({ userId: 'user-1', jti: 'session-1' }),
        }),
      }),
    } as unknown as Model<AuthSessionDocument>;
    const userModel = {
      findById: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue({
            email: 'user@example.com',
            name: 'Test User',
            role: UserRole.User,
            dashboardUnlocked: true,
            authVersion: 1,
          }),
        }),
      }),
    } as unknown as Model<UserDocument>;
    const guard = new JwtAuthGuard(
      { verifyAsync } as unknown as JwtService,
      sessionModel,
      userModel,
    );
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer stale-access-token' },
          path: '/user/overview',
        }),
      }),
    };

    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
