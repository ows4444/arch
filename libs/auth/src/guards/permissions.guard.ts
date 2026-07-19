import { CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { InsufficientPermissionsError } from '../errors/insufficient-permissions.error';
import { AuthorizationService } from '../application/authorization.service';
import type { AuthenticatedUser } from './jwt-auth.guard';

/**
 * Fail-closed: a route with no `@Permissions(...)` metadata is allowed
 * through (authentication alone, via `JwtAuthGuard`, is the requirement),
 * but a route that declares required permissions is denied unless the
 * authenticated user holds every one of them.
 *
 * Checks permissions live against `AuthorizationService` (a fresh DB read)
 * rather than trusting the `permissions` claim embedded in the access
 * token at login time — otherwise granting a permission would have no
 * effect until the user's next login/refresh, contradicting the whole
 * point of RBAC being dynamically managed (see libs/auth/ARCH.md, Key
 * Decisions MEDIUM #2).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();

    const userId = request.user?.userId;

    for (const permission of required) {
      if (
        !userId ||
        !(await this.authorization.hasPermission(userId, permission))
      ) {
        throw new InsufficientPermissionsError(permission);
      }
    }

    return true;
  }
}
