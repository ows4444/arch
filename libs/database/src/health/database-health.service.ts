import { Injectable } from '@nestjs/common';

import { DataSourceManager } from '../datasource/datasource.manager';
import {
  DataSourceMetrics,
  DataSourceStatus,
} from '../interfaces/datasource-state';
import { DatabaseRole } from '../constants/database-role.enum';

export interface DatabaseHealthReport {
  readonly healthy: boolean;

  readonly datasources: readonly {
    name: string;

    writer: boolean;

    status: DataSourceStatus;

    healthy: boolean;

    metrics: Readonly<DataSourceMetrics>;
  }[];
}

@Injectable()
export class DatabaseHealthService {
  constructor(private readonly manager: DataSourceManager) {}

  writer() {
    return this.manager.state(DatabaseRole.WRITE);
  }

  reader() {
    return this.manager.state(DatabaseRole.READ);
  }

  reconnectWriter(): Promise<void> {
    return this.manager.reconnect(DatabaseRole.WRITE);
  }

  reconnectReader(): Promise<void> {
    return this.manager.reconnect(DatabaseRole.READ);
  }

  report(): DatabaseHealthReport {
    const states = this.manager.states();

    return {
      healthy: states.every((state) => state.healthy),
      datasources: states.map((state) => ({
        name: state.name,
        writer: state.isWriter,
        status: state.status,
        healthy: state.healthy,
        metrics: {
          ...state.metrics,
        },
      })),
    };
  }
}
