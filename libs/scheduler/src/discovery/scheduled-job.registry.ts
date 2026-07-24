import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { InjectRepository } from '@/database';
import { SCHEDULED_JOB_METADATA } from '../scheduler.constants';
import type { ScheduledJobMetadata } from '../decorators/scheduled-job.decorator';
import { SchedulerConfigurationError } from '../errors/scheduler-configuration.error';
import { ScheduledJobRepository } from '../domain/scheduled-job.repository';
import { isDuplicateKeyError } from '../domain/is-duplicate-key-error';
import { computeNextFireAt } from '../engine/cron-time.util';

export type ScheduledJobHandler = () => Promise<void> | void;

export interface ScheduledJobDefinition {
  metadata: ScheduledJobMetadata;
  invoke: ScheduledJobHandler;
}

/**
 * Discovers `@ScheduledJob`-decorated methods across every provider the same
 * way `RMQHandlerRegistry` (`libs/queue`) discovers `@RMQConsumer` methods —
 * same scan shape (`DiscoveryService.getProviders` +
 * `MetadataScanner.getAllMethodNames` + `Reflector.get` per method), same
 * duplicate-detection strategy. See `libs/scheduler/ARCH.md` Design 001,
 * Application Layer.
 *
 * Runs discovery from `onApplicationBootstrap`, not `onModuleInit` — unlike
 * `RMQHandlerRegistry` (pure in-memory, no DB access), this class writes to
 * `ScheduledJobRepository` during discovery, and `libs/database`'s own
 * `RepositoryDiscoveryService` (which actually connects the datasource)
 * itself uses `OnApplicationBootstrap`. Nest runs every `onApplicationBootstrap`
 * hook only after *all* modules' `onModuleInit` hooks have resolved, so
 * `onModuleInit` here would race the datasource connection and crash the
 * process on any real `@ScheduledJob` (caught live during this library's
 * Loop 001 boot verification, before it shipped).
 */
@Injectable()
export class ScheduledJobRegistry implements OnApplicationBootstrap {
  private readonly definitions = new Map<string, ScheduledJobDefinition>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    @InjectRepository(ScheduledJobRepository)
    private readonly jobs: ScheduledJobRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
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

        const metadata = this.reflector.get<ScheduledJobMetadata>(
          SCHEDULED_JOB_METADATA,
          methodRef,
        );

        if (!metadata) {
          continue;
        }

        if (this.definitions.has(metadata.name)) {
          throw new SchedulerConfigurationError(
            `Duplicate scheduled job detected: '${metadata.name}'`,
          );
        }

        const typedRef = methodRef as ScheduledJobHandler;

        this.definitions.set(metadata.name, {
          metadata,
          invoke: typedRef.bind(instance),
        });
      }
    }

    for (const definition of this.definitions.values()) {
      await this.syncJob(definition.metadata);
    }
  }

  getDefinition(name: string): ScheduledJobDefinition | undefined {
    return this.definitions.get(name);
  }

  /**
   * Insert-if-missing, else refresh metadata only — `nextFireAt` is only
   * recomputed when the cron expression/timezone actually changed, so an
   * ordinary redeploy doesn't reset (or double-fire) a job's due time. See
   * `libs/scheduler/ARCH.md` Design 001, Key Decisions HIGH #1.
   */
  private async syncJob(metadata: ScheduledJobMetadata): Promise<void> {
    const nextFireAt = computeNextFireAt(
      metadata.cronExpression,
      metadata.timezone,
    );
    const now = new Date();

    let existing = await this.jobs.findByName(metadata.name);

    if (!existing) {
      try {
        await this.jobs.save({
          name: metadata.name,
          cronExpression: metadata.cronExpression,
          timezone: metadata.timezone ?? null,
          misfirePolicy: metadata.misfirePolicy,
          enabled: metadata.enabled,
          nextFireAt,
          createdAt: now,
          updatedAt: now,
        });

        return;
      } catch (error) {
        if (!isDuplicateKeyError(error)) {
          throw error;
        }

        // Lost a create race against another replica booting concurrently —
        // the row now exists; fall through to the metadata-sync path below.
        existing = await this.jobs.findByName(metadata.name);

        if (!existing) {
          throw error;
        }
      }
    }

    const scheduleChanged =
      existing.cronExpression !== metadata.cronExpression ||
      (existing.timezone ?? undefined) !== metadata.timezone;

    await this.jobs.save({
      ...existing,
      cronExpression: metadata.cronExpression,
      timezone: metadata.timezone ?? null,
      misfirePolicy: metadata.misfirePolicy,
      enabled: metadata.enabled,
      ...(scheduleChanged && { nextFireAt }),
    });
  }
}
