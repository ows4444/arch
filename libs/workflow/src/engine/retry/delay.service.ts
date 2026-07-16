import { Injectable } from '@nestjs/common';
import { WorkflowRetryMetadata } from './retry.metadata';

@Injectable()
export class WorkflowRetryDelayService {
  compute(retry: WorkflowRetryMetadata, attempt: number): number {
    switch (retry.strategy) {
      case 'fixed':
        return retry.delayMs ?? 1000;

      case 'linear':
        return (retry.delayMs ?? 1000) * attempt;

      case 'exponential':
        return Math.min(
          (retry.delayMs ?? 1000) * 2 ** (attempt - 1),
          retry.maxDelayMs ?? Number.MAX_SAFE_INTEGER,
        );

      default:
        retry.strategy satisfies never;
        return retry.delayMs ?? 1000;
    }
  }
}
