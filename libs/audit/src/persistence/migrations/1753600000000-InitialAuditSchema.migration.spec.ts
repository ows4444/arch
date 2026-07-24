import { DataSource } from 'typeorm';
import { InitialAuditSchema1753600000000 } from './1753600000000-InitialAuditSchema.migration';
import { AuditEntryEntity } from '../../domain/audit-entry.entity';

describe('InitialAuditSchema migration', () => {
  it('creates audit_entries on up() and drops it on down()', async () => {
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [AuditEntryEntity],
      migrations: [InitialAuditSchema1753600000000],
      synchronize: false,
    });

    await dataSource.initialize();
    await dataSource.runMigrations();

    const queryRunner = dataSource.createQueryRunner();
    expect(await queryRunner.hasTable('audit_entries')).toBe(true);

    const repo = dataSource.getRepository(AuditEntryEntity);
    const saved = await repo.save({
      actorId: 'user-1',
      action: 'role.created',
      targetType: 'role',
      targetId: 'admin',
      metadata: { permissions: ['workflow:read'] },
    });

    const loaded = await repo.findOneBy({ id: saved.id });

    expect(loaded?.action).toBe('role.created');
    expect(loaded?.metadata).toEqual({ permissions: ['workflow:read'] });

    await dataSource.undoLastMigration();
    expect(await queryRunner.hasTable('audit_entries')).toBe(false);

    await dataSource.destroy();
  });
});
