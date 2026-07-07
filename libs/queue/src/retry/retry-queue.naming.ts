export function buildRetryQueueName(params: {
  exchange: string;
  queue: string;
  delaySeconds: number;
}): string {
  return `${params.exchange}.${params.queue}.retry.${params.delaySeconds}s`;
}
