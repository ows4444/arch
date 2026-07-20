import { DataSource } from 'typeorm';
import { VALIDATION_TYPEORM_ENTITIES } from '../persistence/entities';

export async function createValidationTestDataSource(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [...VALIDATION_TYPEORM_ENTITIES],
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
