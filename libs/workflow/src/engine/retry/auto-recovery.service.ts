import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { WorkflowExecutor } from '../executor/executor';
import { WorkflowRegistry } from '../registry/registry';
import { WorkflowRecoveryService } from './recovery.service';
import {
  DEFAULT_SIGNAL_TIMEOUT_MS,
  DEFAULT_STUCK_THRESHOLD_MS,
} from '../../constants/workflow.constants';
import { WORKFLOW_METRICS } from '../../constants/workflow.tokens';
import type { WorkflowMetrics } from '../../models/workflow-metrics';

@Injectable()
export class WorkflowAutoRecoveryService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly timerName = 'workflow-auto-recovery';
  private readonly logger = new Logger(WorkflowAutoRecoveryService.name);

  constructor(
    private readonly recovery: WorkflowRecoveryService,
    private readonly executor: WorkflowExecutor,
    private readonly registry: WorkflowRegistry,
    private readonly scheduler: SchedulerRegistry,

    @Inject(WORKFLOW_METRICS)
    private readonly metrics: WorkflowMetrics,
  ) {}

  onModuleInit(): void {
    const intervals = this.registry
      .getAll()
      .map((w) => w.metadata.autoResume?.intervalMs)
      .filter((x): x is number => x !== undefined);

    const interval = intervals.length > 0 ? Math.min(...intervals) : 30_000;

    this.logger.log(`Auto-recovery sweep scheduled every ${interval}ms`);

    const timer = setInterval(() => {
      void this.recover().catch((error: unknown) => {
        this.logger.error(
          'Auto-recovery sweep failed',
          error instanceof Error ? error.stack : String(error),
        );
      });
    }, interval);

    timer.unref();

    this.scheduler.addInterval(this.timerName, timer);
  }

  onModuleDestroy(): void {
    try {
      this.scheduler.deleteInterval(this.timerName);
    } catch {
      // Interval was never registered.
    }
  }

  async recover(): Promise<void> {
    const workflows = this.registry.getAll();

    const workflowMap = new Map(
      workflows.map((workflow) => [
        WorkflowRegistry.buildKey(
          workflow.metadata.name,
          workflow.metadata.version,
        ),
        workflow,
      ]),
    );

    const stuckThresholds = workflows
      .map((x) => x.metadata.autoResume?.stuckThresholdMs)
      .filter((x): x is number => x !== undefined);

    const threshold =
      stuckThresholds.length > 0
        ? Math.min(...stuckThresholds)
        : DEFAULT_STUCK_THRESHOLD_MS;

    const batchSizes = workflows
      .map((w) => w.metadata.autoResume?.batchSize)
      .filter((x): x is number => x !== undefined && x > 0);

    const batchSize =
      batchSizes.length > 0 ? Math.max(...batchSizes) : undefined;

    this.logger.debug(
      `Recovery sweep started — stuckThresholdMs=${threshold} batchSize=${batchSize ?? 'unlimited'}`,
    );

    let recoveredCount = 0;
    let stuckCount = 0;
    let expiredCount = 0;

    const recoverable =
      await this.recovery.findRecoverableExecutions(batchSize);

    for (const workflow of recoverable) {
      if (workflow.retryAt && workflow.retryAt.getTime() > Date.now()) {
        continue;
      }

      const definition = workflowMap.get(
        WorkflowRegistry.buildKey(
          workflow.workflowName,
          workflow.workflowVersion,
        ),
      );

      if (definition?.metadata.autoResume?.enabled === false) {
        this.logger.debug(
          `Skipping recovery for workflow=${workflow.workflowName} ` +
            `workflowId=${workflow.workflowId} — autoResume disabled`,
        );
        continue;
      }

      const maxAttempts = definition?.metadata.autoResume?.maxAttempts;

      if (
        maxAttempts !== undefined &&
        (workflow.recoveryAttempts ?? 0) >= maxAttempts
      ) {
        this.logger.warn(
          `Skipping recovery for workflow=${workflow.workflowName} ` +
            `workflowId=${workflow.workflowId} — maxAttempts=${maxAttempts} ` +
            `reached (recoveryAttempts=${workflow.recoveryAttempts ?? 0})`,
        );
        continue;
      }

      try {
        await this.executor.resume(workflow.workflowId);
        recoveredCount++;
        this.logger.debug(
          `Resumed workflow=${workflow.workflowName} workflowId=${workflow.workflowId} ` +
            `attempt=${workflow.recoveryAttempts ?? 0}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to resume workflow=${workflow.workflowName} ` +
            `workflowId=${workflow.workflowId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    const stuck = await this.recovery.findStuckExecutions(threshold, batchSize);

    for (const workflow of stuck) {
      try {
        await this.recovery.markAsRecoverable(workflow.workflowId);
        stuckCount++;
        this.logger.debug(
          `Marked stuck workflow=${workflow.workflowName} ` +
            `workflowId=${workflow.workflowId} ` +
            `executingStep=${workflow.executingStep ?? 'unknown'} ` +
            `stepStartedAt=${workflow.stepStartedAt?.toISOString() ?? 'unknown'}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to mark workflow as recoverable: workflow=${workflow.workflowName} ` +
            `workflowId=${workflow.workflowId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    const signalTimeouts = workflows
      .map((w) => w.metadata.signals?.defaultTimeoutMs)
      .filter((x): x is number => x !== undefined);

    const minSignalTimeout =
      signalTimeouts.length > 0
        ? Math.min(...signalTimeouts)
        : DEFAULT_SIGNAL_TIMEOUT_MS;

    const waiting = await this.recovery.findExpiredWaitingExecutions(
      minSignalTimeout,
      batchSize,
    );

    const now = Date.now();

    for (const execution of waiting) {
      const definition = workflowMap.get(
        WorkflowRegistry.buildKey(
          execution.workflowName,
          execution.workflowVersion,
        ),
      );

      const timeout =
        definition?.metadata.signals?.defaultTimeoutMs ??
        DEFAULT_SIGNAL_TIMEOUT_MS;

      if (
        execution.waitingSince &&
        now - execution.waitingSince.getTime() < timeout
      ) {
        continue;
      }

      try {
        await this.executor.cancel(execution.workflowId, true);
        expiredCount++;
        this.logger.debug(
          `Cancelled expired-waiting workflow=${execution.workflowName} ` +
            `workflowId=${execution.workflowId} ` +
            `waitingSince=${execution.waitingSince?.toISOString() ?? 'unknown'} ` +
            `timeoutMs=${timeout}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to cancel expired-waiting workflow=${execution.workflowName} ` +
            `workflowId=${execution.workflowId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    if (recoveredCount > 0 || stuckCount > 0 || expiredCount > 0) {
      this.logger.log(
        `Recovery sweep complete — ` +
          `recovered=${recoveredCount} ` +
          `stuckDetected=${stuckCount} ` +
          `expiredCancelled=${expiredCount}`,
      );
    } else {
      this.logger.debug('Recovery sweep complete — nothing to process');
    }

    this.metrics.sweepRecovered(recoveredCount);
    this.metrics.sweepStuckDetected(stuckCount);
    this.metrics.sweepExpiredCancelled(expiredCount);
  }
}
