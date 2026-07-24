import { AuditService } from './audit.service';

describe('AuditService', () => {
  function setup() {
    const entries = {
      save: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AuditService(entries as never);

    return { service, entries };
  }

  it('saves a full entry as given', async () => {
    const { service, entries } = setup();

    await service.record({
      actorId: 'user-1',
      action: 'role.created',
      targetType: 'role',
      targetId: 'admin',
      metadata: { permissions: ['workflow:read'] },
    });

    expect(entries.save).toHaveBeenCalledWith({
      actorId: 'user-1',
      action: 'role.created',
      targetType: 'role',
      targetId: 'admin',
      metadata: { permissions: ['workflow:read'] },
    });
  });

  it('defaults every optional field to null when omitted', async () => {
    const { service, entries } = setup();

    await service.record({ action: 'system.startup' });

    expect(entries.save).toHaveBeenCalledWith({
      actorId: null,
      action: 'system.startup',
      targetType: null,
      targetId: null,
      metadata: null,
    });
  });

  it('propagates a write failure rather than swallowing it', async () => {
    const { service, entries } = setup();
    entries.save.mockRejectedValue(new Error('connection reset'));

    await expect(service.record({ action: 'role.created' })).rejects.toThrow(
      'connection reset',
    );
  });
});
