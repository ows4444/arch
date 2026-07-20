import { Injectable } from '@nestjs/common';

import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { WorkflowStepId } from '../../models/workflow-step-id';
import { WorkflowStepInputSpecification } from '../../definition/workflow-step-input-specification';

@Injectable()
export class WorkflowStepInputValidator {
  async validate(
    currentStep: WorkflowStepId,
    inputSpec: WorkflowStepInputSpecification<unknown> | undefined,
    data: unknown,
  ): Promise<void> {
    if (!inputSpec) {
      return;
    }

    if (await inputSpec.isSatisfiedBy(data)) {
      return;
    }

    const reasons = await inputSpec.explain(data);

    throw new WorkflowExecutionError(
      `Step '${currentStep}' input failed specification '${inputSpec.name}': ${reasons.join(', ')}`,
    );
  }
}
