import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '@/database';

import { QueueModule } from './queue.module';
import { QUEUE_INBOX_SERVICE } from './queue.constants';
import { QUEUE_TYPEORM_ENTITIES } from './persistence/entities';
import { OutboxService } from './outbox/outbox.service';
import { OutboxDispatcherService } from './outbox/outbox-dispatcher.service';
import { DatabaseQueueInboxService } from './inbox/database-queue-inbox.service';
import { RMQConnection } from './connection/rmq.connection';
import { TopologyBootstrap } from './topology/topology.bootstrap';

describe('QueueModule outbox/inbox wiring (against a real DatabaseModule)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        DatabaseModule.forRootAsync({
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
        }),
        QueueModule.forRoot({
          uri: 'amqp://localhost',
          outbox: {},
          inbox: true,
        }),
      ],
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
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('resolves the outbox service and dispatcher', () => {
    expect(moduleRef.get(OutboxService)).toBeInstanceOf(OutboxService);
    expect(moduleRef.get(OutboxDispatcherService)).toBeInstanceOf(
      OutboxDispatcherService,
    );
  });

  it('resolves the database-backed inbox service when inbox is enabled', () => {
    expect(moduleRef.get(QUEUE_INBOX_SERVICE)).toBeInstanceOf(
      DatabaseQueueInboxService,
    );
  });
});
