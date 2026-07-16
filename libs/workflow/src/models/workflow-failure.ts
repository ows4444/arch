export interface WorkflowFailure {
  readonly code: string;
  readonly message: string;
  readonly retriable: boolean;
}
