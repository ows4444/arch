import type { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { InsufficientRoleError } from '../errors/insufficient-role.error';

describe('RolesGuard', () => {
  function setup(required: string[] | undefined, granted: string[]) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(required),
    };
    const guard = new RolesGuard(reflector as never);

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: { roles: granted } }),
      }),
    } as unknown as ExecutionContext;

    return { guard, context };
  }

  it('allows the request through when no roles are required', () => {
    const { guard, context } = setup(undefined, []);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows the request through when the user holds every required role', () => {
    const { guard, context } = setup(['admin'], ['admin', 'extra']);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws when the user is missing a required role', () => {
    const { guard, context } = setup(['admin'], ['member']);

    expect(() => guard.canActivate(context)).toThrow(InsufficientRoleError);
  });
});
