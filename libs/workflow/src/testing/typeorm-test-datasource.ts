import { DataSource } from 'typeorm';
import { WORKFLOW_TYPEORM_ENTITIES } from '../persistence/adapters/typeorm/entities';

export async function createTestDataSource(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [...WORKFLOW_TYPEORM_ENTITIES],
    synchronize: true,
    dropSchema: true,
  });

  await dataSource.initialize();

  return dataSource;
}
