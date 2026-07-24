import { RefreshTokenService } from './refresh-token.service';
import { TokenRevokedError } from '../errors/token-revoked.error';
import type { AuthModuleOptions } from '../auth.types';

describe('RefreshTokenService', () => {
  function setup(ttlSeconds = 3600) {
    const repository = {
      save: jest.fn().mockResolvedValue(undefined),
      findByTokenHash: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      revokeIfActive: jest.fn().mockResolvedValue(true),
      revokeFamily: jest.fn().mockResolvedValue(undefined),
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
      findActiveForUser: jest.fn().mockResolvedValue([]),
      revokeMany: jest.fn().mockResolvedValue(undefined),
    };
    const events = {
      publishUserRegistered: jest.fn(),
      publishUserLoggedIn: jest.fn(),
      publishPasswordChanged: jest.fn(),
      publishRefreshTokenReuseDetected: jest.fn().mockResolvedValue(undefined),
      publishPasswordResetRequested: jest.fn(),
      publishEmailVerificationRequested: jest.fn(),
    };
    const options: AuthModuleOptions = {
      jwt: { secret: 'secret' },
      refreshTokenTtlSeconds: ttlSeconds,
    };
    const service = new RefreshTokenService(
      repository as never,
      options,
      events,
    );

    return { service, repository, events };
  }

  it('issues a new refresh token and persists its hash, never the raw value', async () => {
    const { service, repository } = setup();

    let savedTokenHash: string | undefined;
    repository.save.mockImplementationOnce(
      (entity: { tokenHash: string }): Promise<void> => {
        savedTokenHash = entity.tokenHash;
        return Promise.resolve(undefined);
      },
    );

    const issued = await service.issue('user-1');

    expect(issued.token).toEqual(expect.any(String));
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        tokenHash: expect.any(String) as string,
        familyId: expect.any(String) as string,
      }),
    );
    expect(savedTokenHash).not.toBe(issued.token);
  });

  it('persists an optional caller-supplied deviceId, or null when omitted', async () => {
    const { service, repository } = setup();

    await service.issue('user-1', { deviceId: 'device-abc' });
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'device-abc' }),
    );

    await service.issue('user-2');
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: null }),
    );
  });

  it('rotates a valid token: revokes the old one and issues a new one in the same family', async () => {
    const { service, repository } = setup();

    const existing = {
      id: 'rt-1',
      userId: 'user-1',
      familyId: 'family-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    repository.findByTokenHash.mockResolvedValue(existing);

    const result = await service.rotate('raw-token');

    expect(result.userId).toBe('user-1');
    expect(repository.revokeIfActive).toHaveBeenCalledWith('rt-1');
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', familyId: 'family-1' }),
    );
  });

  it('throws on an unknown token', async () => {
    const { service, repository } = setup();
    repository.findByTokenHash.mockResolvedValue(null);

    await expect(service.rotate('unknown')).rejects.toThrow(TokenRevokedError);
  });

  it('revokes the entire token family on reuse of an already-rotated token', async () => {
    const { service, repository, events } = setup();

    const existing = {
      id: 'rt-1',
      userId: 'user-1',
      familyId: 'family-1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    };
    repository.findByTokenHash.mockResolvedValue(existing);
    repository.revokeIfActive.mockResolvedValue(false);

    await expect(service.rotate('stolen-token')).rejects.toThrow(
      TokenRevokedError,
    );

    expect(repository.revokeFamily).toHaveBeenCalledWith('family-1');
    expect(events.publishRefreshTokenReuseDetected).toHaveBeenCalledWith({
      userId: 'user-1',
      familyId: 'family-1',
    });
  });

  it('treats a concurrent rotation race (revokeIfActive loses) as reuse too', async () => {
    const { service, repository, events } = setup();

    const existing = {
      id: 'rt-1',
      userId: 'user-1',
      familyId: 'family-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    repository.findByTokenHash.mockResolvedValue(existing);
    repository.revokeIfActive.mockResolvedValue(false);

    await expect(service.rotate('raced-token')).rejects.toThrow(
      TokenRevokedError,
    );

    expect(repository.revokeFamily).toHaveBeenCalledWith('family-1');
    expect(events.publishRefreshTokenReuseDetected).toHaveBeenCalledWith({
      userId: 'user-1',
      familyId: 'family-1',
    });
  });

  it('throws on an expired token without touching the family', async () => {
    const { service, repository } = setup();

    const existing = {
      id: 'rt-1',
      userId: 'user-1',
      familyId: 'family-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    };
    repository.findByTokenHash.mockResolvedValue(existing);

    await expect(service.rotate('expired-token')).rejects.toThrow(
      TokenRevokedError,
    );
    expect(repository.revokeFamily).not.toHaveBeenCalled();
  });

  it('revoke() is a no-op for an unknown or already-revoked token', async () => {
    const { service, repository } = setup();
    repository.findByTokenHash.mockResolvedValue(null);

    await service.revoke('unknown');

    expect(repository.update).not.toHaveBeenCalled();
  });

  describe('session limit enforcement', () => {
    function activeSession(id: string) {
      return {
        id,
        userId: 'user-1',
        familyId: id,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      };
    }

    it('does nothing when active sessions are within the default limit (5)', async () => {
      const { service, repository } = setup();
      repository.findActiveForUser.mockResolvedValue([
        activeSession('rt-1'),
        activeSession('rt-2'),
      ]);

      await service.issue('user-1');

      expect(repository.revokeMany).not.toHaveBeenCalled();
    });

    it('evicts the oldest active sessions once the limit is exceeded', async () => {
      const { service, repository } = setup();
      // findActiveForUser returns oldest-first; 6 active + 1 just issued = 7, over the default 5.
      repository.findActiveForUser.mockResolvedValue([
        activeSession('rt-1'),
        activeSession('rt-2'),
        activeSession('rt-3'),
        activeSession('rt-4'),
        activeSession('rt-5'),
        activeSession('rt-6'),
      ]);

      await service.issue('user-1');

      expect(repository.revokeMany).toHaveBeenCalledWith(['rt-1']);
    });

    it('respects a configured maxActiveSessionsPerUser instead of the library default', async () => {
      const repository = {
        save: jest.fn().mockResolvedValue(undefined),
        findByTokenHash: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        revokeIfActive: jest.fn().mockResolvedValue(true),
        revokeFamily: jest.fn().mockResolvedValue(undefined),
        revokeAllForUser: jest.fn().mockResolvedValue(undefined),
        findActiveForUser: jest
          .fn()
          .mockResolvedValue([activeSession('rt-1'), activeSession('rt-2')]),
        revokeMany: jest.fn().mockResolvedValue(undefined),
      };
      const events = {
        publishUserRegistered: jest.fn(),
        publishUserLoggedIn: jest.fn(),
        publishPasswordChanged: jest.fn(),
        publishRefreshTokenReuseDetected: jest.fn(),
        publishPasswordResetRequested: jest.fn(),
        publishEmailVerificationRequested: jest.fn(),
      };
      const options: AuthModuleOptions = {
        jwt: { secret: 'secret' },
        maxActiveSessionsPerUser: 1,
      };
      const service = new RefreshTokenService(
        repository as never,
        options,
        events,
      );

      await service.issue('user-1');

      expect(repository.revokeMany).toHaveBeenCalledWith(['rt-1']);
    });
  });
});
