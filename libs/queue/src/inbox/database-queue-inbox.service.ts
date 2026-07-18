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

  /**
   * `operation` (the handler body) deliberately runs inside the same DB
   * transaction as the inbox insert, not after it: a crash/throw mid-handler
   * then rolls back the inbox row too, so the message is redelivered rather
   * than silently treated as already-handled. Tradeoff: the transaction's DB
   * connection stays open for the handler's full duration, including any
   * non-DB I/O — revisit (e.g. a configurable non-transactional mode) if
   * that ever causes connection-pool pressure under a slow handler.
   */
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
