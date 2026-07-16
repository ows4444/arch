export interface WorkflowSignal<TPayload = unknown> {
  readonly name: string;

  readonly signalId: string;

  readonly payload?: TPayload;
}
