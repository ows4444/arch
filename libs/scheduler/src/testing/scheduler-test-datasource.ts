import { DataSource } from 'typeorm';
import { SCHEDULER_TYPEORM_ENTITIES } from '../persistence/entities';

export async function createSchedulerTestDataSource(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [...SCHEDULER_TYPEORM_ENTITIES],
    synchronize: true,
    dropSchema: true,
  });

  await dataSource.initialize();

  return dataSource;
}

export function fakeRepositoryResolver(dataSource: DataSource) {
  return {
    resolve: (entity: never) => dataSource.getRepository(entity),
  } as never;
}
