import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { WorkflowRegistry } from '../engine/registry/registry';
import { WorkflowStateService } from '../engine/state/service';
import { WorkflowQueryService } from '../public/api/workflow-query.service';
import {
  WORKFLOW_ARCHIVE_STORE,
  WORKFLOW_METRICS,
} from '../constants/workflow.tokens';
import type { WorkflowArchiveStore } from '../ports/workflow-archive.store';
import type { WorkflowMetrics } from '../models/workflow-metrics';

const MIN_RETENTION_INTERVAL_MS = 60_000; // 60 seconds

@Injectable()
export class WorkflowRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowRetentionService.name);
  private readonly timerName = 'workflow-retention';

  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly stateService: WorkflowStateService,
    private readonly queryService: WorkflowQueryService,

    private readonly scheduler: SchedulerRegistry,

    @Inject(WORKFLOW_METRICS)
    private readonly metrics: WorkflowMetrics,

    @Optional()
    @Inject(WORKFLOW_ARCHIVE_STORE)
    private readonly archiveStore?: WorkflowArchiveStore,
  ) {}

  onModuleInit(): void {
    const ttls = this.registry
      .getAll()
      .map((w) => w.metadata.retention?.ttlMs)
      .filter((x): x is number => x !== undefined && x > 0);

    const interval =
      ttls.length > 0
        ? Math.max(MIN_RETENTION_INTERVAL_MS, Math.min(...ttls))
        : MIN_RETENTION_INTERVAL_MS;

    this.logger.log(
      `Retention cleanup scheduled every ${interval}ms ` +
        `(${ttls.length} workflow(s) with retention configured)`,
    );

    const timer = setInterval(() => {
      void this.cleanup().catch((error: unknown) => {
        this.logger.error(
          'Retention cleanup sweep failed',
          error instanceof Error ? error.stack : String(error),
        );
      });
    }, interval);

    this.scheduler.addInterval(this.timerName, timer);
  }

  onModuleDestroy(): void {
    try {
      this.scheduler.deleteInterval(this.timerName);
    } catch {
      // Interval was never registered — nothing to clean up.
    }
  }

  async cleanup(): Promise<void> {
    let deletedCount = 0;
    let archivedCount = 0;
    let failedCount = 0;

    for (const definition of this.registry.getAll()) {
      const retention = definition.metadata.retention;

      if (!retention) {
        continue;
      }

      const completed = await this.stateService.findCompleted(
        definition.metadata.name,
        definition.metadata.version,
        retention.ttlMs,
        retention.batchSize,
      );

      this.logger.debug(
        `Retention sweep for workflow='${definition.metadata.name}' ` +
          `v${definition.metadata.version}: ` +
          `found ${completed.length} expired execution(s) ` +
          `(ttlMs=${retention.ttlMs} batchSize=${retention.batchSize ?? 'unlimited'})`,
      );

      for (const workflow of completed) {
        try {
          const retention = definition.metadata.retention;

          if (retention?.archiveBeforeDelete) {
            const details = await this.queryService.get(workflow.workflowId);
            await this.archiveStore?.archive(details);

            archivedCount++;
            this.logger.debug(
              `Archived workflow=${workflow.workflowName} ` +
                `workflowId=${workflow.workflowId} ` +
                `completedAt=${workflow.completedAt?.toISOString() ?? 'unknown'}`,
            );
          }

          await this.stateService.delete(workflow.workflowId);
          deletedCount++;
          this.logger.debug(
            `Deleted workflow=${workflow.workflowName} ` +
              `workflowId=${workflow.workflowId} ` +
              `completedAt=${workflow.completedAt?.toISOString() ?? 'unknown'}`,
          );
        } catch (error) {
          failedCount++;
          this.logger.error(
            `Failed to process retention for workflow=${workflow.workflowName} ` +
              `workflowId=${workflow.workflowId}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    }

    if (deletedCount > 0 || archivedCount > 0 || failedCount > 0) {
      this.logger.log(
        `Retention cleanup complete — ` +
          `deleted=${deletedCount} ` +
          `archived=${archivedCount} ` +
          `failed=${failedCount}`,
      );
    } else {
      this.logger.debug('Retention cleanup complete — nothing to process');
    }
    this.metrics.retentionDeleted(deletedCount);
    this.metrics.retentionArchived(archivedCount);
  }
}
