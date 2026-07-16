import { Type } from '@nestjs/common';
import { WorkflowCompensationHandler } from '../handlers/workflow-compensation-handler';

export interface WorkflowStepCompensationMetadata {
  readonly handler: Type<WorkflowCompensationHandler>;
}
