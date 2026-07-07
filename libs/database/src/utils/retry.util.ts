import { Logger } from '@nestjs/common';

export async function retry<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
  },
): Promise<T> {
  let delay = options.initialDelayMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const reason =
        error instanceof AggregateError
          ? error.errors
              .map((cause) =>
                cause instanceof Error ? cause.message : String(cause),
              )
              .join('; ')
          : error instanceof Error
            ? error.message
            : String(error);

      Logger.debug(
        `Database connection attempt ${attempt} failed: ${reason}`,
        'DatabaseRetry',
      );

      if (attempt === options.maxAttempts) {
        break;
      }

      await sleep(withJitter(delay));

      delay = Math.min(delay * 2, options.maxDelayMs);
    }
  }

  throw lastError;
}

function withJitter(delay: number): number {
  const jitter = Math.floor(delay * 0.2 * Math.random());

  return delay + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
