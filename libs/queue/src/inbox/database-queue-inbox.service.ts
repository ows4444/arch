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
      // JSON-encode rather than concatenate with a plain separator: a bare
      // `${consumerKey}:${messageId}` would let two distinct pairs collide
      // whenever either value contains a `:` (e.g. consumerKey="a:b",
      // messageId="c" vs. consumerKey="a", messageId="b:c" both produce
      // "a:b:c"). JSON.stringify escapes both values, so distinct pairs
      // always produce distinct ids. A collision here would silently drop a
      // genuine message as a false "duplicate" (isDuplicateKeyError below).
      const id = JSON.stringify([consumerKey, messageId]);

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
