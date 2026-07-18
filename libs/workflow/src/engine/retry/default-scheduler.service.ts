import { Injectable } from '@nestjs/common';
import { WorkflowRetryScheduler } from '../../models/workflow-retry-scheduler';

@Injectable()
export class DefaultWorkflowRetryScheduler implements WorkflowRetryScheduler {
  async wait(delayMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new DOMException('Operation aborted', 'AbortError');
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);

      timer.unref();

      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(new DOMException('Operation aborted', 'AbortError'));
      };

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
