import 'reflect-metadata';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { RMQHandlerRegistry } from './rmq-handler.registry';
import { RMQConsumer } from './rmq-consumer.decorator';
import { QueueConfigurationError } from '../errors/queue-configuration.error';

const QUEUE_A = { EXCHANGE_NAME: 'ex', QUEUE_NAME: 'q1', ROUTING_KEY: 'rk1' };
const QUEUE_B = { EXCHANGE_NAME: 'ex', QUEUE_NAME: 'q2', ROUTING_KEY: 'rk2' };

class HandlerA {
  @RMQConsumer(QUEUE_A)
  handle(): void {
    // no-op
  }
}

class HandlerB {
  @RMQConsumer(QUEUE_B)
  handle(): void {
    // no-op
  }
}

class DuplicateOfHandlerA {
  @RMQConsumer(QUEUE_A)
  handle(): void {
    // no-op
  }
}

class PlainService {
  handle(): void {
    // not a consumer — no @RMQConsumer metadata
  }
}

function fakeDiscovery(instances: object[]): DiscoveryService {
  return {
    getProviders: jest
      .fn()
      .mockReturnValue(instances.map((instance) => ({ instance }))),
  } as unknown as DiscoveryService;
}

function buildRegistry(instances: object[]): RMQHandlerRegistry {
  return new RMQHandlerRegistry(
    fakeDiscovery(instances),
    new MetadataScanner(),
    new Reflector(),
  );
}

describe('RMQHandlerRegistry', () => {
  it('registers a handler for each @RMQConsumer-decorated method', () => {
    const registry = buildRegistry([new HandlerA(), new HandlerB()]);

    registry.onModuleInit();

    const handlers = registry.getHandlers();

    expect(handlers).toHaveLength(2);
    expect(handlers.map((h) => h.options.queue).sort()).toEqual(['q1', 'q2']);
  });

  it('ignores providers with no @RMQConsumer-decorated methods', () => {
    const registry = buildRegistry([new PlainService()]);

    registry.onModuleInit();

    expect(registry.getHandlers()).toHaveLength(0);
  });

  it('throws QueueConfigurationError when two handlers target the same exchange/queue/routingKey', () => {
    const registry = buildRegistry([new HandlerA(), new DuplicateOfHandlerA()]);

    expect(() => registry.onModuleInit()).toThrow(QueueConfigurationError);
    expect(() => registry.onModuleInit()).toThrow(/Duplicate RMQ consumer/);
  });

  it('binds the invoke function to the original instance', () => {
    class StatefulHandler {
      public receivedThis: unknown;

      @RMQConsumer(QUEUE_A)
      handle(): void {
        this.receivedThis = this;
      }
    }

    const instance = new StatefulHandler();
    const registry = buildRegistry([instance]);

    registry.onModuleInit();

    void registry.getHandlers()[0]?.invoke(undefined, undefined as never);

    expect(instance.receivedThis).toBe(instance);
  });

  it('skips providers with no instance (e.g. unresolved request-scoped providers)', () => {
    const registry = new RMQHandlerRegistry(
      {
        getProviders: jest.fn().mockReturnValue([{ instance: undefined }]),
      } as unknown as DiscoveryService,
      new MetadataScanner(),
      new Reflector(),
    );

    expect(() => registry.onModuleInit()).not.toThrow();
    expect(registry.getHandlers()).toHaveLength(0);
  });
});
