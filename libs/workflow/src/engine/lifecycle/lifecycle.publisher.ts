import { Inject, Injectable, Logger, Type } from '@nestjs/common';
import { WorkflowHookExecutor } from '../hooks/hook-executor';
import { RegisteredWorkflow } from '../../models/registered-workflow';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { WORKFLOW_EVENT_PUBLISHER } from '../../constants/workflow.tokens';
import { WorkflowHook } from '../../models/workflow-hook';
import type {
  WorkflowEventPublisher,
  WorkflowLifecycleEvent,
} from '../../ports/workflow-event-publisher';

@Injectable()
export class WorkflowLifecyclePublisher {
  private readonly logger = new Logger(WorkflowLifecyclePublisher.name);

  constructor(
    private readonly hooks: WorkflowHookExecutor,
    @Inject(WORKFLOW_EVENT_PUBLISHER)
    private readonly events: WorkflowEventPublisher,
  ) {}

  private publish(
    type: WorkflowLifecycleEvent['type'],
    state: WorkflowExecutionState,
    workflow: RegisteredWorkflow,
    hook?: Type<WorkflowHook>,
  ) {
    this.events.publish({ type, state }).catch((error) => {
      this.logger.error(
        `Failed to publish '${type}' event for workflow '${state.workflowId}'`,
        error instanceof Error ? error.stack : String(error),
      );
    });

    return this.hooks.execute(state, hook);
  }

  async started(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
  ): Promise<void> {
    return this.publish(
      'started',
      state,
      workflow,
      workflow.metadata.hooks?.onStart,
    );
  }

  async completed(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
  ): Promise<void> {
    return this.publish(
      'completed',
      state,
      workflow,
      workflow.metadata.hooks?.onComplete,
    );
  }

  async failed(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
  ): Promise<void> {
    return this.publish(
      'failed',
      state,
      workflow,
      workflow.metadata.hooks?.onFailure,
    );
  }

  async cancelled(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
  ): Promise<void> {
    return this.publish(
      'cancelled',
      state,
      workflow,
      workflow.metadata.hooks?.onCancel,
    );
  }

  async expired(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
  ): Promise<void> {
    return this.publish(
      'expired',
      state,
      workflow,
      workflow.metadata.hooks?.onExpire,
    );
  }

  async signalled(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
  ): Promise<void> {
    return this.publish(
      'signalled',
      state,
      workflow,
      workflow.metadata.hooks?.onSignal,
    );
  }
}
