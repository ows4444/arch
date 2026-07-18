import { Type } from '@nestjs/common';
import { WorkflowMetadata } from '../definition/workflow-metadata';
import { WorkflowStepMetadata } from '../definition/workflow-step-metadata';
import { WorkflowCompensationHandler } from '../handlers/workflow-compensation-handler';
import { WorkflowStepHandler } from '../handlers/workflow-step-handler';
import { WorkflowQueryHandler } from './workflow-query-handler';
import { WorkflowStepId } from './workflow-step-id';

export interface RegisteredWorkflowStep {
  readonly metadata: WorkflowStepMetadata;

  readonly type: Type<WorkflowStepHandler>;
}

export interface RegisteredWorkflow {
  readonly metadata: WorkflowMetadata;

  readonly workflowType: Type<unknown>;

  readonly steps: ReadonlyMap<WorkflowStepId, RegisteredWorkflowStep>;

  readonly queries: ReadonlyMap<string, Type<WorkflowQueryHandler>>;

  readonly transitions: ReadonlyMap<
    WorkflowStepId,
    ReadonlySet<WorkflowStepId>
  >;

  readonly compensation?: Type<WorkflowCompensationHandler>;
}
