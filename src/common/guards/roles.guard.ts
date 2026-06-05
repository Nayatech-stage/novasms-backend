import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * RolesGuard — Enforce role-based access control (RG-40)
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @RequireRoles(UserRole.Admin)
 *   async deleteContact(@Param('id') id: string) { ... }
 *
 * Roles:
 *   - Admin : full access to all features
 *   - Editor : can create/edit campaigns, contacts, segments
 *   - Analyst : read-only access to reports and analytics
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Get required roles from @RequireRoles decorator
    const requiredRoles = this.reflector.get<UserRole[]>(
      ROLES_KEY,
      context.getHandler(),
    );

    // If no specific roles required, allow access (guard not used)
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // Get current user from request (set by JwtAuthGuard)
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.role) {
      throw new ForbiddenException('No user role found in token');
    }

    // Check if user role is in allowed roles
    const hasRole = requiredRoles.includes(user.role as UserRole);

    if (!hasRole) {
      throw new ForbiddenException(
        `Insufficient permissions. Required roles: ${requiredRoles.join(', ')}. Your role: ${user.role}`,
      );
    }

    return true;
  }
}
