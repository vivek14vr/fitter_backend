import type { Request } from 'express';
import { UserRole } from './user-role.enum.js';

export interface AuthPayload {
  sub: string;
  jti: string;
  email: string;
  name: string;
  role: UserRole;
  // Optional so tokens issued before the version field was introduced can
  // still be read and invalidated when the user's version changes.
  authVersion?: number;
  iat?: number;
  exp?: number;
}

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  dashboardUnlocked: boolean;
};

export type AuthenticatedIdentity = AuthPayload & {
  dashboardUnlocked: boolean;
};

/**
 * JWT claims are an internal authorization detail. Keep them out of API
 * responses so callers only receive the identity fields they need to render
 * the workspace.
 */
export function toPublicUser(user: AuthenticatedIdentity): PublicUser {
  return {
    id: user.sub,
    name: user.name,
    email: user.email,
    role: user.role,
    dashboardUnlocked: user.dashboardUnlocked,
  };
}

export type AuthenticatedRequest = Request & {
  user: AuthenticatedIdentity;
};
