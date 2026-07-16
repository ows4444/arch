import { Injectable } from '@nestjs/common';

import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { RegisteredWorkflow } from '../../models/registered-workflow';
import { WorkflowStepId } from '../../models/workflow-step-id';
import { WorkflowStepResult } from '../../models/workflow-step-result';

@Injectable()
export class WorkflowStepResultValidator {
  validate(
    workflow: RegisteredWorkflow,
    currentStep: WorkflowStepId,
    result: WorkflowStepResult,
  ): void {
    if (result.nextStep === undefined && result.waitForSignal === undefined) {
      return;
    }

    if (result.waitForSignal && result.nextStep === undefined) {
      throw new WorkflowExecutionError(
        `Step '${currentStep}' waits for a signal but does not specify a resume step.`,
      );
    }

    if (result.nextStep && !workflow.steps.has(result.nextStep)) {
      throw new WorkflowExecutionError(
        `Unknown workflow step '${result.nextStep}'.`,
      );
    }
  }
}
