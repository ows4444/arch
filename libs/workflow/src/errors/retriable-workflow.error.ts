import { WorkflowFailureError } from './workflow-failure.error';

export class RetriableWorkflowError extends WorkflowFailureError {
  constructor(message: string) {
    super(message, true);
  }
}
