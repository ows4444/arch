import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { TransactionExecutor } from './transaction.executor';
import {
  TRANSACTION_METADATA,
  TransactionMetadata,
} from './transaction.constants';

@Injectable()
export class TransactionProviderEnhancer implements OnModuleInit {
  private readonly logger = new Logger(TransactionProviderEnhancer.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly executor: TransactionExecutor,
  ) {}

  onModuleInit(): void {
    const providers = this.discovery.getProviders();

    this.logger.debug(
      `Scanning ${providers.length} providers for transactional methods.`,
    );

    for (const wrapper of providers) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;

      if (!instance) {
        continue;
      }

      const prototype = Object.getPrototypeOf(instance) as object;

      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        this.wrapMethod(instance, prototype, methodName);
      }
    }
  }

  private wrapMethod(
    instance: Record<string, unknown>,
    prototype: object,
    methodName: string,
  ): void {
    const original = instance[methodName];

    if (typeof original !== 'function') {
      return;
    }

    const metadata = this.reflector.getAllAndOverride<TransactionMetadata>(
      TRANSACTION_METADATA,
      [original, prototype.constructor],
    );

    if (!metadata) {
      return;
    }

    instance[methodName] = (...args: unknown[]) =>
      this.executor.execute(
        () =>
          Promise.resolve(
            (original as (...args: unknown[]) => unknown).apply(instance, args),
          ),
        metadata,
      );

    this.logger.debug(`Wrapped ${prototype.constructor.name}.${methodName}()`);
  }
}
