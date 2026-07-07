import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { QueueConfigurationError } from '../errors/queue-configuration.error';
import { RMQ_HANDLER_METADATA } from '../queue.constants';
import type { RmqConsumerOptions } from '../queue.types';
import { RMQHandler } from './rmq-handler.types';

export interface RMQHandlerDefinition {
  options: RmqConsumerOptions;
  invoke: RMQHandler;
}

@Injectable()
export class RMQHandlerRegistry implements OnModuleInit {
  private readonly handlers: RMQHandlerDefinition[] = [];

  private readonly registeredKeys = new Set<string>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const providers = this.discovery.getProviders() as Array<{
      instance?: object;
    }>;

    for (const wrapper of providers) {
      const instance: object | undefined = wrapper.instance;

      if (!instance) {
        continue;
      }

      const prototype = Object.getPrototypeOf(instance) as object | null;

      if (!prototype) {
        continue;
      }

      const methodNames = this.scanner.getAllMethodNames(prototype);

      for (const methodName of methodNames) {
        const methodRef = Reflect.get(prototype, methodName) as unknown;

        if (typeof methodRef !== 'function') {
          continue;
        }

        const metadata = this.reflector.get<RmqConsumerOptions>(
          RMQ_HANDLER_METADATA,
          methodRef,
        );

        if (!metadata) {
          continue;
        }

        const key = [
          metadata.exchange,
          metadata.queue,
          metadata.routingKey,
        ].join(':');

        if (this.registeredKeys.has(key)) {
          throw new QueueConfigurationError(
            `Duplicate RMQ consumer detected: ${key}`,
          );
        }

        this.registeredKeys.add(key);

        const typedRef = methodRef as RMQHandler;

        this.handlers.push({
          options: metadata,
          invoke: typedRef.bind(instance) as RMQHandler,
        });
      }
    }
  }

  getHandlers(): readonly RMQHandlerDefinition[] {
    return this.handlers;
  }
}
