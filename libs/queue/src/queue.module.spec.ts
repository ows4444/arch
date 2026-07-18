import { Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DatabaseModule } from '@/database';

import { QueueModule } from './queue.module';
import { QUEUE_INBOX_SERVICE } from './queue.constants';
import { QUEUE_TYPEORM_ENTITIES } from './persistence/entities';
import { OutboxService } from './outbox/outbox.service';
import { OutboxDispatcherService } from './outbox/outbox-dispatcher.service';
import { NoopQueueInboxService } from './inbox/noop-queue-inbox.service';
import { DatabaseQueueInboxService } from './inbox/database-queue-inbox.service';
import { RMQConnection } from './connection/rmq.connection';
import { TopologyBootstrap } from './topology/topology.bootstrap';
import type { QueueModuleOptions, QueueOptionsFactory } from './queue.types';

function databaseModuleForTests() {
  return DatabaseModule.forRootAsync({
    entities: undefined,
    useFactory: () => ({
      writer: {
        host: 'localhost',
        username: 'test',
        password: 'test',
        database: 'test',
        port: 3306,
        entities: [...QUEUE_TYPEORM_ENTITIES],
      },
      readers: [],
      autoInitialize: false,
    }),
  });
}

async function buildModule(
  queueModule: ReturnType<typeof QueueModule.forRootAsync>,
): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [databaseModuleForTests(), queueModule],
  })
    .overrideProvider(RMQConnection)
    .useValue({
      createChannel: () => ({ on: () => undefined }),
      resolvePrefetch: () => 10,
      close: () => Promise.resolve(),
    })
    .overrideProvider(TopologyBootstrap)
    .useValue({ waitUntilReady: () => Promise.resolve() })
    .compile();
}

describe('QueueModule.forRootAsync', () => {
  it('resolves module options via useFactory and wires the database-backed inbox when enabled', async () => {
    const moduleRef = await buildModule(
      QueueModule.forRootAsync({
        useFactory: (): QueueModuleOptions => ({
          uri: 'amqp://localhost',
          outbox: {},
          inbox: true,
        }),
      }),
    );

    try {
      expect(moduleRef.get(QUEUE_INBOX_SERVICE)).toBeInstanceOf(
        DatabaseQueueInboxService,
      );
      expect(moduleRef.get(OutboxService)).toBeInstanceOf(OutboxService);
    } finally {
      await moduleRef.close();
    }
  });

  it('wires the no-op inbox and leaves the outbox dispatcher inert when disabled', async () => {
    const moduleRef = await buildModule(
      QueueModule.forRootAsync({
        useFactory: (): QueueModuleOptions => ({
          uri: 'amqp://localhost',
        }),
      }),
    );

    try {
      expect(moduleRef.get(QUEUE_INBOX_SERVICE)).toBeInstanceOf(
        NoopQueueInboxService,
      );

      await expect(
        moduleRef.get(OutboxService).enqueue({
          exchange: 'ex',
          routingKey: 'rk',
          payload: {},
        }),
      ).rejects.toThrow();

      const scheduler = moduleRef.get(SchedulerRegistry);
      const addIntervalSpy = jest.spyOn(scheduler, 'addInterval');

      moduleRef.get(OutboxDispatcherService).onModuleInit();

      expect(addIntervalSpy).not.toHaveBeenCalled();
    } finally {
      await moduleRef.close();
    }
  });

  it('resolves module options via useClass', async () => {
    @Injectable()
    class Factory implements QueueOptionsFactory {
      createQueueOptions(): QueueModuleOptions {
        return { uri: 'amqp://localhost', inbox: true };
      }
    }

    const moduleRef = await buildModule(
      QueueModule.forRootAsync({ useClass: Factory }),
    );

    try {
      expect(moduleRef.get(QUEUE_INBOX_SERVICE)).toBeInstanceOf(
        DatabaseQueueInboxService,
      );
    } finally {
      await moduleRef.close();
    }
  });
});
