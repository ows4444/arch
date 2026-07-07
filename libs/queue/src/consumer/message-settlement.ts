import { Logger } from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';

export class MessageSettlement {
  private readonly logger = new Logger(MessageSettlement.name);

  private readonly messageId: string | undefined;

  private settled = false;

  constructor(
    private readonly channel: Channel,
    private readonly message: ConsumeMessage,
  ) {
    this.messageId =
      typeof message.properties.messageId === 'string'
        ? message.properties.messageId
        : undefined;
  }

  ack(): void {
    if (this.settled) {
      this.logger.debug({
        message: 'RabbitMQ message already settled',
        operation: 'ack',
        messageId: this.messageId,
        routingKey: this.message.fields.routingKey,
      });

      return;
    }

    try {
      this.channel.ack(this.message);
      this.settled = true;
    } catch (error: unknown) {
      this.logger.error({
        message: 'RMQ ack failed',
        messageId: this.messageId,
        routingKey: this.message.fields.routingKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  nack(requeue = false): void {
    if (this.settled) {
      this.logger.debug({
        message: 'RabbitMQ message already settled',
        operation: 'nack',
        requeue,
        messageId: this.messageId,
        routingKey: this.message.fields.routingKey,
      });

      return;
    }

    try {
      this.channel.nack(this.message, false, requeue);
      this.settled = true;
    } catch (error: unknown) {
      this.logger.error({
        message: 'RMQ nack failed',
        messageId: this.messageId,
        routingKey: this.message.fields.routingKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }
}
