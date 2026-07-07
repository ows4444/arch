export * from './module/database.module';

export * from './repository/base.repository';
export * from './repository/repository-resolver';

export * from './decorators/database-repository.decorator';
export * from './decorators/inject-repository.decorator';

export * from './constants/database-role.enum';

export * from './transaction/transaction.decorator';
export * from './transaction/transaction.executor';
export * from './transaction/isolation-level';
export * from './transaction/transaction.constants';
export * from './transaction/transaction.context';
export * from './transaction/transaction.hooks';

export * from './interfaces/database-module-options';
export * from './interfaces/database-bootstrap-options.interface';
export * from './interfaces/datasource-state';
export * from './interfaces/repository-metadata.interface';
export * from './health/database-health.service';
export type { DatabaseHealthReport } from './health/database-health.service';
