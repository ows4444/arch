export class QueueConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = QueueConfigurationError.name;
  }
}
