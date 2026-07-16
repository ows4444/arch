import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { createWorkflowStepId } from '../../models/workflow-step-id';

export function createWorkflowExecutionState(
  overrides: Partial<WorkflowExecutionState> = {},
): WorkflowExecutionState {
  return {
    executionId: 'execution-1',
    correlationId: 'correlation-1',
    workflowId: 'workflow-1',
    workflowName: 'test-workflow',
    status: 'running',
    historyCount: 0,
    stateVersion: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    workflowVersion: 1,
    iteration: 0,
    data: {},
    currentStep: createWorkflowStepId('step-1'),
    ...overrides,
  };
}
