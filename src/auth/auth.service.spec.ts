import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { Model } from 'mongoose';
import { AuthService } from './auth.service.js';
import type { AuthSessionDocument } from './schemas/auth-session.schema.js';
import type { UserDocument } from './schemas/user.schema.js';
import { UserRole } from './user-role.enum.js';

describe('AuthService session lifecycle', () => {
  const user = {
    _id: { toString: () => 'user-1' },
    name: 'Test User',
    email: 'user@example.com',
    role: UserRole.User,
    authVersion: 3,
  } as unknown as UserDocument;

  const session = {
    _id: 'session-1',
    userId: 'user-1',
    jti: 'jti-1',
  } as unknown as AuthSessionDocument;

  function createService() {
    const findById = vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(user) });
    const findOne = vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(session) });
    const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const signAsync = vi.fn().mockResolvedValue('next-access-token');
    const verifyAsync = vi.fn().mockResolvedValue({ sub: 'user-1', jti: 'jti-1' });
    const userModel = {
      findById,
    } as unknown as Model<UserDocument>;
    const sessionModel = {
      findOne,
      updateOne,
    } as unknown as Model<AuthSessionDocument>;
    const jwtService = {
      signAsync,
      verifyAsync,
    } as unknown as JwtService;

    return {
      service: new AuthService(userModel, sessionModel, jwtService),
      userModel,
      sessionModel,
      jwtService,
      updateOne,
      verifyAsync,
      signAsync,
    };
  }

  it('atomically rotates a refresh token', async () => {
    const { service, updateOne } = createService();

    const result = await service.refresh('current-refresh-token');

    expect(result.accessToken).toBe('next-access-token');
    expect(result.user.id).toBe('user-1');
    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'session-1',
        revokedAt: null,
        expiresAt: expect.objectContaining({ $gt: expect.any(Date) }),
        refreshTokenHash: expect.any(String),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          tokenHash: expect.any(String),
          refreshTokenHash: expect.any(String),
        }),
      }),
    );
  });

  it('mints refresh access tokens with the current user auth version', async () => {
    const { service, signAsync } = createService();

    await service.refresh('current-refresh-token');

    expect(signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ authVersion: 3 }),
      { expiresIn: '15m' },
    );
  });

  it('rejects a refresh token that lost the rotation race', async () => {
    const { service, updateOne } = createService();
    updateOne.mockResolvedValueOnce({ modifiedCount: 0 } as never);

    await expect(service.refresh('replayed-refresh-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects valid credentials submitted to the wrong portal', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    const loginUser = {
      _id: { toString: () => 'user-1' },
      name: 'Test User',
      email: 'user@example.com',
      role: UserRole.User,
      passwordHash,
    } as UserDocument;
    const findOne = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(loginUser) }),
    });
    const userModel = { findOne } as unknown as Model<UserDocument>;
    const create = vi.fn();
    const sessionModel = {
      create,
    } as unknown as Model<AuthSessionDocument>;
    const jwtService = {
      signAsync: vi.fn(),
    } as unknown as JwtService;
    const service = new AuthService(userModel, sessionModel, jwtService);

    await expect(
      service.login({
        email: 'user@example.com',
        password: 'password123',
        role: UserRole.Admin,
      }),
    ).rejects.toThrow('This account cannot use the selected portal');
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a normal user account and starts a session', async () => {
    const createdUser = {
      _id: { toString: () => 'new-user-1' },
      name: 'New User',
      email: 'new.user@example.com',
      role: UserRole.User,
    } as unknown as UserDocument;
    const exists = vi.fn().mockResolvedValue(null);
    const createUser = vi.fn().mockResolvedValue(createdUser);
    const createSession = vi.fn().mockResolvedValue({});
    const userModel = { exists, create: createUser } as unknown as Model<UserDocument>;
    const sessionModel = { create: createSession } as unknown as Model<AuthSessionDocument>;
    const jwtService = {
      signAsync: vi.fn().mockResolvedValue('signup-access-token'),
    } as unknown as JwtService;
    const service = new AuthService(userModel, sessionModel, jwtService);

    const result = await service.signup({
      name: '  New   User ',
      email: 'NEW.USER@example.com',
      password: 'password123',
      confirmPassword: 'password123',
    });

    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({
      name: 'New User',
      email: 'new.user@example.com',
      role: UserRole.User,
      dashboardUnlocked: false,
      passwordHash: expect.any(String),
    }));
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ userId: 'new-user-1' }));
    expect(result).toMatchObject({
      accessToken: 'signup-access-token',
      user: { id: 'new-user-1', role: UserRole.User },
    });
  });

  it('rejects mismatched or duplicate signup credentials', async () => {
    const exists = vi.fn().mockResolvedValue(null);
    const createUser = vi.fn();
    const userModel = { exists, create: createUser } as unknown as Model<UserDocument>;
    const sessionModel = { create: vi.fn() } as unknown as Model<AuthSessionDocument>;
    const jwtService = { signAsync: vi.fn() } as unknown as JwtService;
    const service = new AuthService(userModel, sessionModel, jwtService);

    await expect(service.signup({
      name: 'New User',
      email: 'new.user@example.com',
      password: 'password123',
      confirmPassword: 'different123',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(createUser).not.toHaveBeenCalled();

    exists.mockResolvedValueOnce({ _id: 'existing' });
    await expect(service.signup({
      name: 'New User',
      email: 'new.user@example.com',
      password: 'password123',
      confirmPassword: 'password123',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('revokes by refresh token even when no access token is available', async () => {
    const { service, updateOne, verifyAsync } = createService();

    await service.logout('', 'refresh-token');

    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('can revoke an expired access token using its claims', async () => {
    const { service, updateOne, verifyAsync } = createService();

    await service.logout('expired-access-token');

    expect(verifyAsync).toHaveBeenCalledWith('expired-access-token', {
      ignoreExpiration: true,
    });
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenLastCalledWith(
      { userId: 'user-1', jti: 'jti-1', revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } },
    );
  });
});
