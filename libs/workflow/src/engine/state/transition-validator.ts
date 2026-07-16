import { Injectable } from '@nestjs/common';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { RegisteredWorkflow } from '../../models/registered-workflow';
import { WorkflowStepId } from '../../models/workflow-step-id';

@Injectable()
export class WorkflowTransitionValidator {
  validate(
    workflow: RegisteredWorkflow,
    current: WorkflowStepId,
    next?: WorkflowStepId,
  ): void {
    if (!next) {
      return;
    }

    const allowed = workflow.transitions.get(current);

    if (!allowed?.has(next)) {
      throw new WorkflowExecutionError(
        `Workflow '${workflow.metadata.name}' cannot transition from '${current}' to '${next}'`,
      );
    }
  }
}
