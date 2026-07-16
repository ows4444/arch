import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { WORKFLOW_STATE_STORE } from '../../constants/workflow.tokens';
import type { WorkflowStateStore } from '../../ports/workflow-state-store';
import { WorkflowConcurrencyError } from '../../errors/workflow.errors';

const SHUTDOWN_GRACE_MS = 5_000;
const SHUTDOWN_POLL_MS = 100;

@Injectable()
export class WorkflowLeaseService implements OnApplicationShutdown {
  private readonly ownerId = randomUUID();
  private readonly logger = new Logger(WorkflowLeaseService.name);

  private readonly heldLeases = new Set<string>();

  constructor(
    @Inject(WORKFLOW_STATE_STORE)
    private readonly store: WorkflowStateStore,
  ) {}

  async acquire(
    workflowId: string,
    leaseMs = 60_000,
  ): Promise<string | undefined> {
    if (!this.store.acquireLease) {
      return undefined;
    }

    const expiresAt = new Date(Date.now() + leaseMs);

    const acquired = await this.store.acquireLease(
      workflowId,
      this.ownerId,
      expiresAt,
    );

    if (!acquired) {
      throw new WorkflowConcurrencyError(
        `Workflow '${workflowId}' is already leased`,
      );
    }

    this.heldLeases.add(workflowId);

    return this.ownerId;
  }

  async release(workflowId: string): Promise<void> {
    this.heldLeases.delete(workflowId);

    if (!this.store.releaseLease) {
      return;
    }

    await this.store.releaseLease(workflowId, this.ownerId);
  }

  async onApplicationShutdown(): Promise<void> {
    const deadline = Date.now() + SHUTDOWN_GRACE_MS;

    while (this.heldLeases.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_POLL_MS));
    }

    if (this.heldLeases.size === 0) {
      return;
    }

    const stillHeld = [...this.heldLeases];

    this.logger.warn(
      `Force-releasing ${stillHeld.length} lease(s) still held after a ` +
        `${SHUTDOWN_GRACE_MS}ms shutdown grace period: ${stillHeld.join(', ')}`,
    );

    await Promise.allSettled(
      stillHeld.map((workflowId) => this.release(workflowId)),
    );
  }

  async renew(workflowId: string, leaseMs = 60_000): Promise<void> {
    if (!this.store.renewLease) {
      return;
    }

    const renewed = await this.store.renewLease(
      workflowId,
      this.ownerId,
      new Date(Date.now() + leaseMs),
    );

    if (!renewed) {
      throw new WorkflowConcurrencyError(
        `Lease lost for workflow '${workflowId}'`,
      );
    }
  }

  keepAlive(workflowId: string, leaseMs = 60_000): () => void {
    const intervalMs = Math.max(1_000, Math.floor(leaseMs / 2));

    const timer = setInterval(() => {
      void this.renew(workflowId, leaseMs).catch((error: unknown) => {
        this.logger.warn(
          `Lease lost for workflow '${workflowId}' — stopping keep-alive. ` +
            `Another node may have acquired the lease. ` +
            (error instanceof Error ? error.message : String(error)),
        );
        clearInterval(timer);
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }
}
