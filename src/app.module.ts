import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CacheModule, CacheModuleOptions } from '@/cache';
import { DatabaseBootstrapOptions, DatabaseModule } from '@/database';
import { QueueModule, QUEUE_TYPEORM_ENTITIES, QUEUE_MIGRATIONS } from '@/queue';
import {
  WorkflowModule,
  WORKFLOW_TYPEORM_ENTITIES,
  WORKFLOW_MIGRATIONS,
} from '@/workflow';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IoRedisClientAdapter } from './redis/ioredis-client.adapter';

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

    DatabaseModule.forRoot({
      entities: [
        ...QUEUE_TYPEORM_ENTITIES,
        ...WORKFLOW_TYPEORM_ENTITIES,
      ] as unknown as DatabaseBootstrapOptions['entities'],

      migrations: [...QUEUE_MIGRATIONS, ...WORKFLOW_MIGRATIONS],
    }),

    CacheModule.forRootAsync({
      useFactory: (...args: readonly unknown[]): CacheModuleOptions => {
        const config = args[0] as ConfigService;

        return {
          caches: {
            default: {
              type: 'redis',
              options: {
                client: new IoRedisClientAdapter(
                  new Redis({
                    host: config.getOrThrow<string>('REDIS_HOST'),
                    port: Number(config.getOrThrow<string>('REDIS_PORT')),
                    password: config.get<string>('REDIS_PASSWORD'),
                    tls:
                      config.get<string>('REDIS_TLS') === 'true'
                        ? {}
                        : undefined,
                  }),
                ),
                namespace: 'app',
              },
            },
            'orders-l1': {
              type: 'memory',
              options: { capacity: 500, ttl: 30_000 },
            },
            orders: {
              type: 'multi-level',
              options: { l1: 'orders-l1', l2: 'default' },
            },
          },
        };
      },
      inject: [ConfigService],
    }),

    QueueModule.forRoot({
      uri: buildRabbitMqUri(),
      outbox: {},
      inbox: true,
    }),

    WorkflowModule.forRoot({ persistence: 'database' }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
