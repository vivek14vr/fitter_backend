import {
  BadRequestException,
  ConflictException,
  Logger,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Model } from 'mongoose';
import type { AuthPayload } from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';
import {
  AuthSession,
  AuthSessionDocument,
} from './schemas/auth-session.schema.js';
import { User } from './schemas/user.schema.js';
import type { UserDocument } from './schemas/user.schema.js';
import { SignupDto } from './dto/signup.dto.js';
import { UserRole } from './user-role.enum.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(AuthSession.name)
    private readonly sessionModel: Model<AuthSessionDocument>,
    private readonly jwtService: JwtService,
  ) {}

  private readonly refreshTokenTtlMs = 7 * 24 * 60 * 60 * 1000;

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private createRefreshToken() {
    return randomBytes(48).toString('base64url');
  }

  private async createAccessToken(payload: AuthPayload) {
    return this.jwtService.signAsync(payload, { expiresIn: '15m' });
  }

  private write(
    event: string,
    metadata: Record<string, unknown>,
    level: 'log' | 'warn' | 'error' = 'log',
  ) {
    this.logger[level](
      JSON.stringify({
        timestamp: new Date().toISOString(),
        event,
        ...metadata,
      }),
    );
  }

  private publicUser(user: UserDocument) {
    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      dashboardUnlocked: user.dashboardUnlocked !== false,
    };
  }

  private async createSession(user: UserDocument) {
    const payload: AuthPayload = {
      sub: user._id.toString(),
      jti: randomUUID(),
      email: user.email,
      name: user.name,
      role: user.role,
      authVersion: user.authVersion ?? 0,
    };
    const expiresAt = new Date(Date.now() + this.refreshTokenTtlMs);
    const accessToken = await this.createAccessToken(payload);
    const refreshToken = this.createRefreshToken();

    await this.sessionModel.create({
      userId: payload.sub,
      jti: payload.jti,
      tokenHash: this.hashToken(accessToken),
      refreshTokenHash: this.hashToken(refreshToken),
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
      user: this.publicUser(user),
    };
  }

  async login(loginDto: LoginDto) {
    try {
      const email = loginDto.email.trim().toLowerCase();
      const user = await this.userModel
        .findOne({ email })
        .select('+passwordHash')
        .exec();

      if (!user || !(await bcrypt.compare(loginDto.password, user.passwordHash))) {
        this.write('auth.login.denied', {
          reason: user ? 'invalid_password' : 'unknown_account',
          requestedRole: loginDto.role ?? 'unspecified',
        }, 'warn');
        throw new UnauthorizedException('Invalid email or password');
      }

      if (loginDto.role && user.role !== loginDto.role) {
        this.write('auth.login.denied', {
          reason: 'role_mismatch',
          requestedRole: loginDto.role,
          accountRole: user.role,
        }, 'warn');
        throw new UnauthorizedException('This account cannot use the selected portal');
      }

      const result = await this.createSession(user);

      this.write('auth.login.success', {
        userId: user._id.toString(),
        role: user.role,
      });

      return result;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      this.write('auth.login.failed', {
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }, 'error');
      throw error;
    }
  }

  async signup(signupDto: SignupDto) {
    try {
      const name = signupDto.name.trim().replace(/\s+/g, ' ');
      const email = signupDto.email.trim().toLowerCase();

      if (signupDto.password !== signupDto.confirmPassword) {
        throw new BadRequestException('Passwords do not match');
      }

      const existingUser = await this.userModel.exists({ email });
      if (existingUser) {
        this.write('auth.signup.denied', { reason: 'duplicate_email' }, 'warn');
        throw new ConflictException('An account with this email already exists');
      }

      const user = await this.userModel.create({
        name,
        email,
        passwordHash: await bcrypt.hash(signupDto.password, 12),
        role: UserRole.User,
        dashboardUnlocked: false,
      });
      const result = await this.createSession(user);

      this.write('auth.signup.success', {
        userId: user._id.toString(),
        role: user.role,
      });

      return result;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) {
        throw error;
      }
      if (typeof error === 'object' && error !== null && 'code' in error
        && (error as { code?: unknown }).code === 11000) {
        throw new ConflictException('An account with this email already exists');
      }

      this.write('auth.signup.failed', {
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }, 'error');
      throw error;
    }
  }

  async refresh(refreshToken: string) {
    try {
      if (!refreshToken) {
        this.write('auth.refresh.denied', { reason: 'missing_token' }, 'warn');
        throw new UnauthorizedException('Refresh token required');
      }

      const session = await this.sessionModel
        .findOne({
          refreshTokenHash: this.hashToken(refreshToken),
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        })
        .exec();

      if (!session) {
        this.write('auth.refresh.denied', { reason: 'inactive_session' }, 'warn');
        throw new UnauthorizedException('Refresh session is no longer active');
      }

      const user = await this.userModel.findById(session.userId).exec();

      if (!user) {
        this.write('auth.refresh.denied', { reason: 'user_not_found' }, 'warn');
        throw new UnauthorizedException('User no longer exists');
      }

      const payload: AuthPayload = {
        sub: user._id.toString(),
        jti: session.jti,
        email: user.email,
        name: user.name,
        role: user.role,
        authVersion: user.authVersion ?? 0,
      };
      const accessToken = await this.createAccessToken(payload);
      const nextRefreshToken = this.createRefreshToken();

      const rotation = await this.sessionModel.updateOne(
        {
          _id: session._id,
          refreshTokenHash: this.hashToken(refreshToken),
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        },
        {
          $set: {
            tokenHash: this.hashToken(accessToken),
            refreshTokenHash: this.hashToken(nextRefreshToken),
          },
        },
      );

      if (rotation.modifiedCount !== 1) {
        this.write('auth.refresh.denied', { reason: 'rotation_race' }, 'warn');
        throw new UnauthorizedException('Refresh token has already been used');
      }

      this.write('auth.refresh.success', {
        userId: user._id.toString(),
        role: user.role,
      });

      return {
        accessToken,
        refreshToken: nextRefreshToken,
        user: this.publicUser(user),
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      this.write('auth.refresh.failed', {
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }, 'error');
      throw error;
    }
  }

  async logout(accessToken: string, refreshToken = '') {
    if (refreshToken) {
      try {
        const refreshLogout = await this.sessionModel.updateOne(
          {
            refreshTokenHash: this.hashToken(refreshToken),
            revokedAt: null,
          },
          { $set: { revokedAt: new Date() } },
        );

        if (refreshLogout.modifiedCount === 1) {
          this.write('auth.logout.success', { source: 'refresh_token' });
          return;
        }
      } catch (error) {
        this.write('auth.logout.failed', {
          source: 'refresh_token',
          errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
        }, 'error');
        throw error;
      }
    }

    let payload: AuthPayload;

    try {
      payload = await this.jwtService.verifyAsync<AuthPayload>(accessToken, {
        ignoreExpiration: true,
      });
    } catch {
      // Logout remains idempotent when the access token has already expired.
      this.write('auth.logout.completed_without_token', {
        reason: 'access_token_unusable',
      }, 'warn');
      return;
    }

    try {
      await this.sessionModel.updateOne(
        { userId: payload.sub, jti: payload.jti, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
      this.write('auth.logout.success', {
        source: 'access_token',
        userId: payload.sub,
      });
    } catch (error) {
      this.write('auth.logout.failed', {
        source: 'access_token',
        userId: payload.sub,
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }, 'error');
      throw error;
    }
  }
}
