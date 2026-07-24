import type {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
  Type,
} from '@nestjs/common';

export interface SchedulerModuleOptions {
  /** How often the sweep polls for due jobs. Defaults to `DEFAULT_SCHEDULER_SWEEP_INTERVAL_MS`. */
  sweepIntervalMs?: number;

  /** How long a claim is honored before another replica may reclaim it. Defaults to `DEFAULT_SCHEDULER_CLAIM_STALE_MS`. */
  claimStaleMs?: number;

  /** Max due jobs claimed per sweep. Defaults to `DEFAULT_SCHEDULER_BATCH_SIZE`. */
  batchSize?: number;
}

export interface SchedulerOptionsFactory {
  createSchedulerOptions():
    SchedulerModuleOptions | Promise<SchedulerModuleOptions>;
}

export interface SchedulerModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  inject?: (InjectionToken | OptionalFactoryDependency)[];

  useExisting?: Type<SchedulerOptionsFactory>;

  useClass?: Type<SchedulerOptionsFactory>;

  useFactory?: (
    ...args: readonly unknown[]
  ) => SchedulerModuleOptions | Promise<SchedulerModuleOptions>;
}
