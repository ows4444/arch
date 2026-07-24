import { Injectable } from '@nestjs/common';
import { WorkflowMetrics } from '../models/workflow-metrics';

@Injectable()
export class NoopWorkflowMetricsService implements WorkflowMetrics {
  sweepRecovered(): void {}
  sweepStuckDetected(): void {}
  sweepExpiredCancelled(): void {}
  sweepSleepWoken(): void {}
  sweepStuckJoinResumed(): void {}
  sweepPendingEffectsReplayed(): void {}
  retentionDeleted(): void {}
  retentionArchived(): void {}
  workflowStarted(): void {}

  workflowCompleted(): void {}

  workflowFailed(): void {}

  workflowCancelled(): void {}

  workflowRecovered(): void {}

  signalReceived(): void {}

  retryScheduled(): void {}

  stepStarted(): void {}

  stepCompleted(): void {}

  hookFailed(): void {}

  compensationFailed(): void {}
}
