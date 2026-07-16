import { Test } from '@nestjs/testing';
import { DatabaseModule } from './database.module';
import { DataSourceManager } from '../datasource/datasource.manager';
import { RepositoryResolver } from '../repository/repository-resolver';
import { TransactionExecutor } from '../transaction/transaction.executor';
import { DatabaseHealthService } from '../health/database-health.service';
import type { ResolvedDatabaseOptions } from '../interfaces/database-resolved-options.interface';

function fakeOptions(): ResolvedDatabaseOptions {
  return {
    writer: {
      host: 'localhost',
      username: 'user',
      password: 'pass',
      database: 'db',
      port: 3306,
    },
    readers: [],
  };
}

describe('DatabaseModule wiring', () => {
  it('resolves core providers from the compiled module graph without connecting to a database', async () => {
    // .compile() builds the DI graph but does not run OnModuleInit/OnApplicationBootstrap
    // lifecycle hooks (only .init() does), so no real datasource connection is attempted.
    const moduleRef = await Test.createTestingModule({
      imports: [
        DatabaseModule.forRootAsync({
          useFactory: () => fakeOptions(),
          entities: undefined,
        }),
      ],
    }).compile();

    expect(moduleRef.get(DataSourceManager)).toBeInstanceOf(DataSourceManager);
    expect(moduleRef.get(RepositoryResolver)).toBeInstanceOf(
      RepositoryResolver,
    );
    expect(moduleRef.get(TransactionExecutor)).toBeInstanceOf(
      TransactionExecutor,
    );
    expect(moduleRef.get(DatabaseHealthService)).toBeInstanceOf(
      DatabaseHealthService,
    );
  });
});
