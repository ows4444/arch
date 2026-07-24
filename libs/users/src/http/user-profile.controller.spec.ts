import { UserProfileController } from './user-profile.controller';
import type { AuthenticatedUser } from '@/auth';

describe('UserProfileController', () => {
  function setup() {
    const profiles = {
      getOrCreateMine: jest.fn(),
      updateMine: jest.fn(),
      getForUser: jest.fn(),
    };
    const controller = new UserProfileController(profiles as never);

    return { controller, profiles };
  }

  const user = { userId: 'user-1' } as AuthenticatedUser;

  it('delegates getMine to UserProfileService.getOrCreateMine', async () => {
    const { controller, profiles } = setup();
    profiles.getOrCreateMine.mockResolvedValue({
      userId: 'user-1',
      displayName: 'Jane',
    });

    const result = await controller.getMine(user);

    expect(profiles.getOrCreateMine).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ userId: 'user-1', displayName: 'Jane' });
  });

  it('delegates updateMine to UserProfileService.updateMine', async () => {
    const { controller, profiles } = setup();
    profiles.updateMine.mockResolvedValue({
      userId: 'user-1',
      displayName: 'Jane Doe',
    });

    await controller.updateMine(user, { displayName: 'Jane Doe' });

    expect(profiles.updateMine).toHaveBeenCalledWith('user-1', {
      displayName: 'Jane Doe',
    });
  });

  it('delegates getForUser with the route param and the caller as separate arguments', async () => {
    const { controller, profiles } = setup();
    profiles.getForUser.mockResolvedValue({
      userId: 'user-2',
      displayName: 'Someone Else',
    });

    await controller.getForUser('user-2', user);

    expect(profiles.getForUser).toHaveBeenCalledWith('user-2', 'user-1');
  });
});
