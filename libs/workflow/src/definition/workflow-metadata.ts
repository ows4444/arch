import { Provider, Type } from '@nestjs/common';
import { WorkflowCompensationMetadata } from '../engine/compensation/compensation.metadata';
import { WorkflowHookMetadata } from '../engine/hooks/hook.metadata';
import { WorkflowRetryMetadata } from '../engine/retry/retry.metadata';
import { WorkflowSignalMetadata } from '../engine/signals/signal.metadata';
import { WorkflowRetentionMetadata } from '../retention/retention.metadata';
import { WorkflowAutoResumeMetadata } from './workflow-auto-resume-metadata';
import { WorkflowChildMetadata } from './workflow-child-metadata';
import { WorkflowDefinitionMetadata } from './workflow-definition-metadata';
import { WorkflowObservabilityMetadata } from './workflow-observability-metadata';
import { WorkflowPersistenceMetadata } from './workflow-persistence-metadata';

export interface WorkflowMetadata {
  readonly name: string;

  readonly version: number;

  readonly description?: string;

  readonly defaultStepTimeoutMs?: number;

  readonly imports?: Type<unknown>[];

  readonly providers?: Provider[];

  readonly exports?: Provider[];

  readonly definition: WorkflowDefinitionMetadata;

  readonly retries?: WorkflowRetryMetadata;

  readonly hooks?: WorkflowHookMetadata;

  readonly autoResume?: WorkflowAutoResumeMetadata;

  readonly retention?: WorkflowRetentionMetadata;

  readonly compensation?: WorkflowCompensationMetadata;

  readonly persistence?: WorkflowPersistenceMetadata;

  readonly signals?: WorkflowSignalMetadata;

  readonly childWorkflows?: WorkflowChildMetadata[];

  readonly observability?: WorkflowObservabilityMetadata;
}
