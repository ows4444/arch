import { Injectable } from '@nestjs/common';
import { QueueInboxService } from './queue-inbox.service';

@Injectable()
export class NoopQueueInboxService implements QueueInboxService {
  async withIdempotency(
    _consumerKey: string,
    _messageId: string,
    operation: () => Promise<void>,
  ): Promise<boolean> {
    await operation();

    return true;
  }
}
