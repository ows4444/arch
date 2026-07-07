import type { ConsumeMessage } from 'amqplib';
import { RMQ_HEADERS, RMQ_MAX_RETRY_COUNT } from '../queue.constants';
import { parseIntegerHeader } from '../utils/header-utils';

function normalizeRetryCount(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= RMQ_MAX_RETRY_COUNT
    ? value
    : 0;
}

export function getRetryCount(message: ConsumeMessage): number {
  const value: unknown = message.properties.headers?.[RMQ_HEADERS.RETRY_COUNT];

  return normalizeRetryCount(parseIntegerHeader(value) ?? 0);
}
