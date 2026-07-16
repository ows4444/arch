import { WorkflowExecutionState } from '../models/workflow-execution-state';
import { WorkflowSignalRecord } from '../models/workflow-signal-record';
import { WorkflowStepExecution } from '../models/workflow-step-execution';

export interface WorkflowDetails {
  readonly state: WorkflowExecutionState;

  readonly history: readonly WorkflowStepExecution[];

  readonly pendingSignals: readonly WorkflowSignalRecord[];
}
