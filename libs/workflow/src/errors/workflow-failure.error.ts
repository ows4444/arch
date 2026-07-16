export abstract class WorkflowFailureError extends Error {
  protected constructor(
    message: string,
    public readonly retriable: boolean,
  ) {
    super(message);
  }
}
