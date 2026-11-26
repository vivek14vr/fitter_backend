import { toPublicUser } from './auth.types.js';
import { UserRole } from './user-role.enum.js';

describe('toPublicUser', () => {
  it('returns only the identity fields needed by the client', () => {
    const publicUser = toPublicUser({
      sub: 'user-1',
      jti: 'session-1',
      email: 'user@example.com',
      name: 'Test User',
      role: UserRole.User,
      dashboardUnlocked: true,
      iat: 100,
      exp: 200,
    });

    expect(publicUser).toEqual({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      role: UserRole.User,
      dashboardUnlocked: true,
    });
    expect(publicUser).not.toHaveProperty('jti');
    expect(publicUser).not.toHaveProperty('iat');
    expect(publicUser).not.toHaveProperty('exp');
  });
});
