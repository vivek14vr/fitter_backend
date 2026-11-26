import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../auth.types.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { UserRole } from '../user-role.enum.js';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!roles?.length) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    if (!request.user || !roles.includes(request.user.role)) {
      this.logger.warn(JSON.stringify({
        event: 'auth.role_access.denied',
        path: request.path,
        actualRole: request.user?.role ?? 'anonymous',
        requiredRoles: roles,
      }));
      throw new ForbiddenException('Your account cannot access this area');
    }

    return true;
  }
}
