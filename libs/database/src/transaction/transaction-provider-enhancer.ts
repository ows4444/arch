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
        this.warnIfDecoratedWithoutInstance(wrapper);
        continue;
      }

      const prototype = Object.getPrototypeOf(instance) as object;

      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        this.wrapMethod(instance, prototype, methodName);
      }
    }
  }

  private warnIfDecoratedWithoutInstance(
    wrapper: ReturnType<DiscoveryService['getProviders']>[number],
  ): void {
    const metatype = wrapper.metatype;

    if (typeof metatype !== 'function') {
      return;
    }

    const prototype = (metatype as { prototype?: object }).prototype;

    if (!prototype) {
      return;
    }

    for (const methodName of this.scanner.getAllMethodNames(prototype)) {
      const original = (prototype as Record<string, unknown>)[methodName];

      if (typeof original !== 'function') {
        continue;
      }

      const metadata = this.reflector.getAllAndOverride<TransactionMetadata>(
        TRANSACTION_METADATA,
        [original, metatype],
      );

      if (metadata) {
        this.logger.warn(
          `${metatype.name}.${methodName}() is decorated with @Transactional() but has no singleton instance at module-init time (likely REQUEST- or TRANSIENT-scoped) — @Transactional() only patches singleton instances, so this method will run WITHOUT transaction propagation/rollback semantics.`,
        );
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
