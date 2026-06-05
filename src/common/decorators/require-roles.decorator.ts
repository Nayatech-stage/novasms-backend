import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../guards/roles.guard';

/**
 * @RequireRoles() — Decorator to specify required roles for an endpoint
 *
 * Usage:
 *   @RequireRoles(UserRole.Admin, UserRole.Editor)
 *   @Post('/campaigns')
 *   async create(@Body() dto: CreateCampaignDto) { ... }
 */
export const RequireRoles = (...roles: UserRole[]) =>
  SetMetadata(ROLES_KEY, roles);
