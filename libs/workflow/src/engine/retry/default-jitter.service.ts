import { Injectable } from '@nestjs/common';
import { WorkflowRetryJitter } from '../../models/workflow-retry-jitter';

@Injectable()
export class DefaultWorkflowRetryJitterService implements WorkflowRetryJitter {
  apply(baseDelayMs: number, _attempt: number): number {
    return Math.floor(Math.random() * baseDelayMs);
  }
}
