import { CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { InsufficientRoleError } from '../errors/insufficient-role.error';
import { AuthorizationService } from '../application/authorization.service';
import type { AuthenticatedUser } from './jwt-auth.guard';

/**
 * Fail-closed, mirroring `PermissionsGuard`: a route with no `@Roles(...)`
 * metadata is allowed through, but a route that declares required roles is
 * denied unless the authenticated user holds every one of them. Checked
 * live against `AuthorizationService`, not the token's embedded `roles`
 * claim — same reasoning as `PermissionsGuard`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();

    const userId = request.user?.userId;

    for (const role of required) {
      if (!userId || !(await this.authorization.hasRole(userId, role))) {
        throw new InsufficientRoleError(role);
      }
    }

    return true;
  }
}
