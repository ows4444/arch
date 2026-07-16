export interface QueueInboxService {
  withIdempotency(
    consumerKey: string,
    messageId: string,
    operation: () => Promise<void>,
  ): Promise<boolean>;
}
