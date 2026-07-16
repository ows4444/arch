import { Inject, Injectable } from '@nestjs/common';
import { RegisteredWorkflow } from '../models/registered-workflow';
import { WorkflowExecutionState } from '../models/workflow-execution-state';
import { WORKFLOW_SNAPSHOT_STORE } from '../constants/workflow.tokens';
import type { WorkflowSnapshotStore } from '../ports/workflow-snapshot.store';

@Injectable()
export class WorkflowPersistenceService {
  constructor(
    @Inject(WORKFLOW_SNAPSHOT_STORE)
    private readonly snapshotStore: WorkflowSnapshotStore,
  ) {}

  loadSnapshot(workflowId: string): Promise<WorkflowExecutionState | null> {
    return this.snapshotStore.load(workflowId);
  }

  shouldSnapshot(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
  ): boolean {
    const frequency = workflow.metadata.persistence?.snapshotEvery;

    if (!frequency || frequency <= 0) {
      return false;
    }

    return state.historyCount > 0 && state.historyCount % frequency === 0;
  }

  async snapshot(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
  ): Promise<void> {
    if (!this.shouldSnapshot(workflow, state)) {
      return;
    }

    await this.snapshotStore.snapshot(workflow, state);
  }

  async recoverSnapshot(
    current: WorkflowExecutionState,
  ): Promise<WorkflowExecutionState | null> {
    const snapshot = await this.snapshotStore.load(current.workflowId);

    if (!snapshot) {
      return null;
    }

    if (snapshot.workflowId !== current.workflowId) {
      return null;
    }

    if (snapshot.stateVersion < current.stateVersion) {
      return null;
    }

    if (snapshot.historyCount < current.historyCount) {
      return null;
    }

    return snapshot;
  }
}
