import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@/database';
import { QueueModule, QUEUE_TYPEORM_ENTITIES, QUEUE_MIGRATIONS } from '@/queue';
import {
  NotificationModule,
  NOTIFICATION_EMAIL_TOPOLOGY,
  LoggingEmailSender,
} from '@/notification';
import { WorkerController } from './worker.controller';
import { WorkerService } from './worker.service';
import { WORKER_SMOKE_TEST_TOPOLOGY } from './queue/worker-smoke-test.topology';
import { WorkerSmokeTestConsumer } from './queue/worker-smoke-test.consumer';
import { EmailNotificationConsumer } from './queue/email-notification.consumer';

/**
 * Duplicated from apps/server/src/app.module.ts rather than shared — apps/* don't import from
 * each other in this monorepo (only libs/* are shared), and this is five lines of env plumbing,
 * not a real abstraction worth a new lib. See apps/worker/LOOP.md, Loop 002.
 */
function buildRabbitMqUri(): string {
  const host = process.env.RABBITMQ_HOST ?? 'localhost';
  const port = process.env.RABBITMQ_PORT ?? '5672';
  const username = process.env.RABBITMQ_USERNAME ?? 'guest';
  const password = process.env.RABBITMQ_PASSWORD ?? 'guest';

  return `amqp://${username}:${password}@${host}:${port}`;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Only the queue lib's own entities/migrations — this app hosts no auth/workflow/validation
    // modules, so it has no reason to own their schema. The same physical database as
    // apps/server (shared MySQL instance, migrations are idempotent per-name), just a narrower
    // slice of it.
    DatabaseModule.forRoot({
      entities: [...QUEUE_TYPEORM_ENTITIES],
      migrations: [...QUEUE_MIGRATIONS],
    }),

    QueueModule.forRoot({
      uri: buildRabbitMqUri(),
      topology: [WORKER_SMOKE_TEST_TOPOLOGY, NOTIFICATION_EMAIL_TOPOLOGY],
      outbox: {},
      inbox: true,
    }),

    // Same LoggingEmailSender as apps/server — see libs/notification/ARCH.md,
    // Rejected Alternatives (no real SMTP/SendGrid/SES dependency exists).
    NotificationModule.forRoot({ emailSender: new LoggingEmailSender() }),
  ],
  controllers: [WorkerController],
  providers: [
    WorkerService,
    WorkerSmokeTestConsumer,
    EmailNotificationConsumer,
  ],
})
export class WorkerModule {}
