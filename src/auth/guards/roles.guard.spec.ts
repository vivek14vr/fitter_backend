import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { UserRole } from '../user-role.enum.js';

function createContext(role?: UserRole) {
  return {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        path: '/protected',
        user: role ? { role } : undefined,
      }),
    }),
  } as never;
}

describe('RolesGuard', () => {
  it('allows an authenticated account with a required role', () => {
    const getAllAndOverride = vi.fn().mockReturnValue([UserRole.Admin]);
    const reflector = {
      getAllAndOverride,
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(createContext(UserRole.Admin))).toBe(true);
    expect(getAllAndOverride).toHaveBeenCalledWith(
      ROLES_KEY,
      expect.any(Array),
    );
  });

  it('rejects a missing or mismatched role', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue([UserRole.Admin]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(createContext(UserRole.User))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(createContext())).toThrow(ForbiddenException);
  });
});
