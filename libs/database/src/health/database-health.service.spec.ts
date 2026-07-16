import { DatabaseHealthService } from './database-health.service';
import { DataSourceManager } from '../datasource/datasource.manager';
import { DatabaseRole } from '../constants/database-role.enum';
import { DataSourceStatus } from '../interfaces/datasource-state';

function redactedState(name: string) {
  return {
    name,
    isWriter: name === 'writer',
    configuration: { password: '***REDACTED***', host: 'db' },
    status: DataSourceStatus.READY,
    healthy: true,
    dataSource: undefined,
    reconnectPromise: undefined,
    metrics: {},
  };
}

function fakeDataSourceManager(): DataSourceManager {
  return {
    state: jest.fn((role: DatabaseRole) =>
      redactedState(role === DatabaseRole.WRITE ? 'writer' : 'reader'),
    ),
    states: jest.fn(() => [redactedState('writer'), redactedState('reader')]),
    reconnect: jest.fn(),
  } as unknown as DataSourceManager;
}

describe('DatabaseHealthService', () => {
  it('returns a redacted configuration for the writer', () => {
    const manager = fakeDataSourceManager();
    const service = new DatabaseHealthService(manager);

    const result = service.writer();

    expect(result.configuration.password).toBe('***REDACTED***');
  });

  it('returns a redacted configuration for the reader, using the redacted state() accessor', () => {
    const manager = fakeDataSourceManager();
    const service = new DatabaseHealthService(manager);

    const result = service.reader();

    expect(result.configuration.password).toBe('***REDACTED***');
    expect(manager.state).toHaveBeenCalledWith(DatabaseRole.READ);
  });

  it('never exposes the live, unredacted writerState()/readerState() accessors through reader()', () => {
    const manager = fakeDataSourceManager();
    const service = new DatabaseHealthService(manager);

    service.reader();

    expect(manager.state).toHaveBeenCalled();
  });
});
