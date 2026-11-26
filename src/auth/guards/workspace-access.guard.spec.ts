import { ForbiddenException } from '@nestjs/common';
import { WorkspaceAccessGuard } from './workspace-access.guard.js';
import { UserRole } from '../user-role.enum.js';

function createContext(role: UserRole, dashboardUnlocked: boolean) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        path: '/user/overview',
        user: { sub: 'user-1', role, dashboardUnlocked },
      }),
    }),
  } as never;
}

describe('WorkspaceAccessGuard', () => {
  it('blocks a locked normal user workspace', () => {
    const guard = new WorkspaceAccessGuard();

    expect(() => guard.canActivate(createContext(UserRole.User, false)))
      .toThrow(ForbiddenException);
  });

  it('allows unlocked users and non-user workspaces', () => {
    const guard = new WorkspaceAccessGuard();

    expect(guard.canActivate(createContext(UserRole.User, true))).toBe(true);
    expect(guard.canActivate(createContext(UserRole.Nutritionist, false))).toBe(true);
  });
});
