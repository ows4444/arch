import { Inject, Injectable, Logger } from '@nestjs/common';
import amqpConnectionManager, {
  type AmqpConnectionManager,
  type ChannelWrapper,
} from 'amqp-connection-manager';
import { connect, type Channel, type ChannelModel } from 'amqplib';
import { QueueConfigurationError } from '../errors/queue-configuration.error';
import { RMQ_DEFAULT_PREFETCH, RMQ_MODULE_OPTIONS } from '../queue.constants';
import type { QueueModuleOptions } from '../queue.types';

@Injectable()
export class RMQConnection {
  private static readonly DEFAULT_CONNECTION_NAME = 'nestjs-rmq';

  private static readonly RAW_CONNECT_MAX_RETRIES = 10;

  private static readonly MAX_PREFETCH = 100;

  private static readonly RAW_CONNECT_BASE_DELAY_MS = 1000;

  private static readonly RAW_CONNECT_MAX_DELAY_MS = 30_000;

  private readonly logger = new Logger(RMQConnection.name);

  private readonly connection: AmqpConnectionManager;

  private readonly resolvedConnectionName: string;

  private rawConnectionPromise: Promise<ChannelModel> | undefined;

  constructor(
    @Inject(RMQ_MODULE_OPTIONS)
    private readonly options: QueueModuleOptions,
  ) {
    this.resolvedConnectionName =
      options.connectionName ?? RMQConnection.DEFAULT_CONNECTION_NAME;

    this.connection = amqpConnectionManager.connect([this.options.uri], {
      connectionOptions: {
        clientProperties: {
          connection_name: this.resolvedConnectionName,
        },
      },
    });

    this.connection.on('connect', () => {
      this.logger.log({
        message: 'RabbitMQ connected',
        connectionName: this.resolvedConnectionName,
      });
    });

    this.connection.on('disconnect', (params) => {
      this.logger.error({
        message: 'RabbitMQ disconnected',
        connectionName: this.resolvedConnectionName,
        error: params.err?.message,
        stack: params.err?.stack,
      });
    });
  }

  createChannel(
    name: string,
    setup?: (channel: Channel) => Promise<void>,
  ): ChannelWrapper {
    const channelOpts: Parameters<AmqpConnectionManager['createChannel']>[0] = {
      name,
      confirm: true,
    };

    if (setup) {
      channelOpts.setup = setup;
    }

    const channel = this.connection.createChannel(channelOpts);

    channel.on('error', (error) => {
      this.logger.error({
        message: 'RabbitMQ channel error',
        channel: name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });

    return channel;
  }

  resolvePrefetch(value?: number): number {
    return this.validatePrefetch(
      value ?? this.options.prefetch ?? RMQ_DEFAULT_PREFETCH,
    );
  }

  async createRawChannel(): Promise<Channel> {
    const connection = await this.getRawConnection();

    return connection.createChannel();
  }

  private getRawConnection(): Promise<ChannelModel> {
    this.rawConnectionPromise ??= this.openRawConnection().catch((error) => {
      this.rawConnectionPromise = undefined;

      throw error;
    });

    return this.rawConnectionPromise;
  }

  private async openRawConnection(): Promise<ChannelModel> {
    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <= RMQConnection.RAW_CONNECT_MAX_RETRIES;
      attempt++
    ) {
      try {
        const connection = await connect(this.options.uri, {
          clientProperties: {
            connection_name: `${this.resolvedConnectionName}:topology`,
          },
        });

        this.attachRawConnectionListeners(connection);

        return connection;
      } catch (error) {
        lastError = error;

        const delay = Math.min(
          RMQConnection.RAW_CONNECT_BASE_DELAY_MS *
            (Math.pow(2, attempt - 1) + Math.random()),
          RMQConnection.RAW_CONNECT_MAX_DELAY_MS,
        );

        this.logger.warn({
          message: 'RabbitMQ raw connection failed',
          attempt,
          maxRetries: RMQConnection.RAW_CONNECT_MAX_RETRIES,
          retryInMs: delay,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private attachRawConnectionListeners(connection: ChannelModel): void {
    const currentPromise = this.rawConnectionPromise;

    connection.on('error', (error) => {
      this.logger.debug({
        message: 'RabbitMQ raw connection error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });

    connection.on('close', () => {
      if (this.rawConnectionPromise === currentPromise) {
        this.rawConnectionPromise = undefined;
      }

      this.logger.debug({
        message: 'RabbitMQ raw connection closed',
      });
    });
  }

  /**
   * Closes the shared AMQP connection (and the raw topology connection, if
   * ever opened). Deliberately not an `OnApplicationShutdown` hook: Nest runs
   * every provider's shutdown hook within a module concurrently via
   * `Promise.all`, so there is no ordering guarantee relative to
   * `RMQConsumerRuntime`'s drain sequence. Callers that depend on this
   * connection (currently `RMQConsumerRuntime`) must call `close()`
   * themselves once they've finished using it.
   */
  async close(): Promise<void> {
    const rawConnection = await this.rawConnectionPromise?.catch(
      () => undefined,
    );

    await Promise.allSettled([this.connection.close(), rawConnection?.close()]);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms).unref();
    });
  }

  private validatePrefetch(prefetch: number): number {
    if (!Number.isInteger(prefetch) || prefetch <= 0) {
      throw new QueueConfigurationError(
        `Invalid RabbitMQ prefetch value: ${prefetch}`,
      );
    }

    if (prefetch > RMQConnection.MAX_PREFETCH) {
      throw new QueueConfigurationError(
        `RabbitMQ prefetch exceeds maximum allowed value (${RMQConnection.MAX_PREFETCH})`,
      );
    }

    return prefetch;
  }
}
