import type { ExecutionContext } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import { InsufficientPermissionsError } from '../errors/insufficient-permissions.error';

describe('PermissionsGuard', () => {
  function setup(required: string[] | undefined, granted: string[]) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(required),
    };
    const guard = new PermissionsGuard(reflector as never);

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: { permissions: granted } }),
      }),
    } as unknown as ExecutionContext;

    return { guard, context };
  }

  it('allows the request through when no permissions are required', () => {
    const { guard, context } = setup(undefined, []);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows the request through when the user holds every required permission', () => {
    const { guard, context } = setup(
      ['workflow:read', 'workflow:write'],
      ['workflow:read', 'workflow:write', 'extra'],
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws when the user is missing a required permission', () => {
    const { guard, context } = setup(['workflow:write'], ['workflow:read']);

    expect(() => guard.canActivate(context)).toThrow(
      InsufficientPermissionsError,
    );
  });
});
