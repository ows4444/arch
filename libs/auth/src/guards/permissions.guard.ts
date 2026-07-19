import { CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { InsufficientPermissionsError } from '../errors/insufficient-permissions.error';
import type { AuthenticatedUser } from './jwt-auth.guard';

/**
 * Fail-closed: a route with no `@Permissions(...)` metadata is allowed
 * through (authentication alone, via `JwtAuthGuard`, is the requirement),
 * but a route that declares required permissions is denied unless the
 * authenticated user holds every one of them.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
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

    const granted = new Set(request.user?.permissions ?? []);

    for (const permission of required) {
      if (!granted.has(permission)) {
        throw new InsufficientPermissionsError(permission);
      }
    }

    return true;
  }
}
