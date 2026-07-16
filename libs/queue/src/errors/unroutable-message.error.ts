export class UnroutableMessageError extends Error {
  constructor(params: {
    exchange: string;
    routingKey: string;
    messageId: string;
  }) {
    super(
      `RabbitMQ message could not be routed to any queue ` +
        `(exchange="${params.exchange}", routingKey="${params.routingKey}", messageId="${params.messageId}")`,
    );
    this.name = UnroutableMessageError.name;
  }
}
