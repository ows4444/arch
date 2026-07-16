import { Injectable } from '@nestjs/common';
import {
  DatabaseRole,
  InjectRepository,
  TransactionExecutor,
} from '@/database';
import { InboxRepository } from './inbox.repository';
import { QueueInboxService } from './queue-inbox.service';
import { isDuplicateKeyError } from './is-duplicate-key-error';

@Injectable()
export class DatabaseQueueInboxService implements QueueInboxService {
  constructor(
    @InjectRepository(InboxRepository, DatabaseRole.WRITE)
    private readonly inbox: InboxRepository,

    private readonly transactionExecutor: TransactionExecutor,
  ) {}

  async withIdempotency(
    consumerKey: string,
    messageId: string,
    operation: () => Promise<void>,
  ): Promise<boolean> {
    return this.transactionExecutor.execute(async () => {
      const id = `${consumerKey}:${messageId}`;

      try {
        await this.inbox.insert({
          id,
          consumerKey,
          messageId,
          processedAt: new Date(),
        });
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return false;
        }

        throw error;
      }

      await operation();

      return true;
    });
  }
}
