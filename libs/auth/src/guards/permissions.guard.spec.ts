import type { ExecutionContext } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import { InsufficientPermissionsError } from '../errors/insufficient-permissions.error';

describe('PermissionsGuard', () => {
  function setup(
    required: string[] | undefined,
    grantedPermissions: string[],
    userId = 'user-1',
  ) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(required),
    };
    const authorization = {
      hasPermission: jest
        .fn()
        .mockImplementation((_userId: string, permission: string) =>
          Promise.resolve(grantedPermissions.includes(permission)),
        ),
    };
    const guard = new PermissionsGuard(
      reflector as never,
      authorization as never,
    );

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId } }),
      }),
    } as unknown as ExecutionContext;

    return { guard, context, authorization };
  }

  it('allows the request through when no permissions are required', async () => {
    const { guard, context } = setup(undefined, []);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows the request through when the user holds every required permission', async () => {
    const { guard, context } = setup(
      ['workflow:read', 'workflow:write'],
      ['workflow:read', 'workflow:write', 'extra'],
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('throws when the user is missing a required permission', async () => {
    const { guard, context } = setup(['workflow:write'], ['workflow:read']);

    await expect(guard.canActivate(context)).rejects.toThrow(
      InsufficientPermissionsError,
    );
  });

  it('checks the permission live via AuthorizationService, not a cached claim', async () => {
    const { guard, context, authorization } = setup(
      ['workflow:read'],
      ['workflow:read'],
    );

    await guard.canActivate(context);

    expect(authorization.hasPermission).toHaveBeenCalledWith(
      'user-1',
      'workflow:read',
    );
  });
});
