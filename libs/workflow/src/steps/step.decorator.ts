import { applyDecorators, Injectable, SetMetadata } from '@nestjs/common';

import { WORKFLOW_STEP_METADATA } from '../constants/workflow.constants';
import { WorkflowStepMetadata } from '../definition/workflow-step-metadata';

export function Step(metadata: WorkflowStepMetadata): ClassDecorator {
  return applyDecorators(
    Injectable(),
    SetMetadata(WORKFLOW_STEP_METADATA, Object.freeze({ ...metadata })),
  );
}
