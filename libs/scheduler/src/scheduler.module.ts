import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { SCHEDULER_MODULE_OPTIONS } from './scheduler.constants';
import type {
  SchedulerModuleAsyncOptions,
  SchedulerModuleOptions,
  SchedulerOptionsFactory,
} from './scheduler.types';
import { ScheduledJobRegistry } from './discovery/scheduled-job.registry';
import { ScheduledJobSweepService } from './engine/scheduled-job-sweep.service';

const CORE_EXPORTS = [ScheduledJobRegistry];

@Global()
@Module({})
export class SchedulerModule {
  static forRoot(options: SchedulerModuleOptions = {}): DynamicModule {
    return {
      module: SchedulerModule,
      global: true,
      imports: [DiscoveryModule, ScheduleModule.forRoot()],
      providers: [
        { provide: SCHEDULER_MODULE_OPTIONS, useValue: options },
        ...this.coreProviders(),
      ],
      exports: CORE_EXPORTS,
    };
  }

  static forRootAsync(options: SchedulerModuleAsyncOptions): DynamicModule {
    return {
      module: SchedulerModule,
      global: true,
      imports: [
        DiscoveryModule,
        ScheduleModule.forRoot(),
        ...(options.imports ?? []),
      ],
      providers: [
        ...this.createAsyncOptionsProviders(options),
        ...this.coreProviders(),
      ],
      exports: CORE_EXPORTS,
    };
  }

  private static coreProviders(): Provider[] {
    return [ScheduledJobRegistry, ScheduledJobSweepService];
  }

  private static createAsyncOptionsProviders(
    options: SchedulerModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: SCHEDULER_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: SCHEDULER_MODULE_OPTIONS,
          useFactory: (factory: SchedulerOptionsFactory) =>
            factory.createSchedulerOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    if (options.useClass) {
      return [
        options.useClass,
        {
          provide: SCHEDULER_MODULE_OPTIONS,
          useFactory: (factory: SchedulerOptionsFactory) =>
            factory.createSchedulerOptions(),
          inject: [options.useClass],
        },
      ];
    }

    throw new Error('Invalid SchedulerModuleAsyncOptions.');
  }
}
