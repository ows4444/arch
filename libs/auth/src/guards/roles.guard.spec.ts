import type { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { InsufficientRoleError } from '../errors/insufficient-role.error';

describe('RolesGuard', () => {
  function setup(
    required: string[] | undefined,
    grantedRoles: string[],
    userId = 'user-1',
  ) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(required),
    };
    const authorization = {
      hasRole: jest
        .fn()
        .mockImplementation((_userId: string, role: string) =>
          Promise.resolve(grantedRoles.includes(role)),
        ),
    };
    const guard = new RolesGuard(reflector as never, authorization as never);

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId } }),
      }),
    } as unknown as ExecutionContext;

    return { guard, context, authorization };
  }

  it('allows the request through when no roles are required', async () => {
    const { guard, context } = setup(undefined, []);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows the request through when the user holds every required role', async () => {
    const { guard, context } = setup(['admin'], ['admin', 'extra']);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('throws when the user is missing a required role', async () => {
    const { guard, context } = setup(['admin'], ['member']);

    await expect(guard.canActivate(context)).rejects.toThrow(
      InsufficientRoleError,
    );
  });

  it('checks the role live via AuthorizationService, not a cached claim', async () => {
    const { guard, context, authorization } = setup(['admin'], ['admin']);

    await guard.canActivate(context);

    expect(authorization.hasRole).toHaveBeenCalledWith('user-1', 'admin');
  });
});
