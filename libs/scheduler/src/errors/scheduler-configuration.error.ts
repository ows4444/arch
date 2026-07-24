/** Mirrors `QueueConfigurationError`/`WorkflowConfigurationError`'s shape — a boot-time misconfiguration, not an HTTP-facing exception (this library has no HTTP surface). */
export class SchedulerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = SchedulerConfigurationError.name;
  }
}
