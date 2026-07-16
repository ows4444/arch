import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { TransactionProviderEnhancer } from './transaction-provider-enhancer';
import { TransactionExecutor } from './transaction.executor';
import { Transactional } from './transaction.decorator';

class RequestScopedService {
  @Transactional()
  doWork(): Promise<void> {
    return Promise.resolve();
  }
}

class PlainRequestScopedService {
  doWork(): void {
    // no @Transactional() here
  }
}

function fakeDiscovery(
  providers: { instance: unknown; metatype: unknown }[],
): DiscoveryService {
  return {
    getProviders: jest.fn().mockReturnValue(providers),
  } as unknown as DiscoveryService;
}

function fakeExecutor(): TransactionExecutor {
  return {
    execute: jest.fn(),
  } as unknown as TransactionExecutor;
}

describe('TransactionProviderEnhancer', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('warns when a @Transactional() method exists on a provider with no singleton instance', () => {
    const discovery = fakeDiscovery([
      { instance: undefined, metatype: RequestScopedService },
    ]);
    const enhancer = new TransactionProviderEnhancer(
      discovery,
      new MetadataScanner(),
      new Reflector(),
      fakeExecutor(),
    );

    enhancer.onModuleInit();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('RequestScopedService.doWork()'),
    );
  });

  it('does not warn for a provider with no instance and no @Transactional() methods', () => {
    const discovery = fakeDiscovery([
      { instance: undefined, metatype: PlainRequestScopedService },
    ]);
    const enhancer = new TransactionProviderEnhancer(
      discovery,
      new MetadataScanner(),
      new Reflector(),
      fakeExecutor(),
    );

    enhancer.onModuleInit();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn when the provider has a live singleton instance (normal wrapping path)', () => {
    const instance = new RequestScopedService();
    const discovery = fakeDiscovery([
      { instance, metatype: RequestScopedService },
    ]);
    const enhancer = new TransactionProviderEnhancer(
      discovery,
      new MetadataScanner(),
      new Reflector(),
      fakeExecutor(),
    );

    enhancer.onModuleInit();

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
