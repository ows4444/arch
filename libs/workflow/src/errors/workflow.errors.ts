export abstract class WorkflowError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class WorkflowConfigurationError extends WorkflowError {
  constructor(message: string) {
    super(message);
  }
}

export class WorkflowExecutionError extends WorkflowError {
  constructor(message: string) {
    super(message);
  }
}

export class WorkflowConcurrencyError extends WorkflowError {
  constructor(message: string) {
    super(message);
  }
}
