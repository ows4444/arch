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
    const sleeping =
      result.sleepUntil !== undefined || result.sleepMs !== undefined;
    const spawning = (result.spawnChildren?.length ?? 0) > 0;

    if ([result.waitForSignal, sleeping, spawning].filter(Boolean).length > 1) {
      throw new WorkflowExecutionError(
        `Step '${currentStep}' must use only one of waitForSignal, sleep, or spawnChildren.`,
      );
    }

    if (
      result.nextStep === undefined &&
      result.waitForSignal === undefined &&
      !sleeping &&
      !spawning
    ) {
      return;
    }

    if (result.waitForSignal && result.nextStep === undefined) {
      throw new WorkflowExecutionError(
        `Step '${currentStep}' waits for a signal but does not specify a resume step.`,
      );
    }

    if (sleeping && result.nextStep === undefined) {
      throw new WorkflowExecutionError(
        `Step '${currentStep}' sleeps but does not specify a resume step.`,
      );
    }

    if (spawning && result.nextStep === undefined) {
      throw new WorkflowExecutionError(
        `Step '${currentStep}' spawns children but does not specify a join step.`,
      );
    }

    if (result.nextStep && !workflow.steps.has(result.nextStep)) {
      throw new WorkflowExecutionError(
        `Unknown workflow step '${result.nextStep}'.`,
      );
    }
  }
}
