import { WorkflowFailureError } from './workflow-failure.error';

export class NonRetriableWorkflowError extends WorkflowFailureError {
  constructor(message: string) {
    super(message, false);
  }
}
