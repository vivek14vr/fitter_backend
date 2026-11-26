import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth.types.js';
import { UserRole } from '../user-role.enum.js';

@Injectable()
export class WorkspaceAccessGuard implements CanActivate {
  private readonly logger = new Logger(WorkspaceAccessGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    if (request.user.role === UserRole.User && !request.user.dashboardUnlocked) {
      this.logger.warn(JSON.stringify({
        event: 'auth.workspace_access.denied',
        reason: 'dashboard_locked',
        userId: request.user.sub,
        path: request.path,
      }));
      throw new ForbiddenException('Your dashboard is awaiting admin approval');
    }

    return true;
  }
}
