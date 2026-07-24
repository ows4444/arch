import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { requestContext } from './request-context';

interface JsonLogObject {
  level: LogLevel;
  pid: number;
  timestamp: number;
  message: unknown;
  context?: string;
  stack?: unknown;
  requestId?: string;
}

/**
 * Structured (one-JSON-object-per-line) logging via Nest's built-in
 * `json: true` `ConsoleLogger` mode, with the active request's correlation
 * id (if any — background work like the outbox dispatcher or the workflow
 * recovery sweep runs with no HTTP request in scope) merged into every log
 * object, so a client-facing error and its corresponding server-side log
 * lines can be found by the same id, and the stream stays machine-parseable
 * for a log aggregator instead of relying on timestamp-matching a plain-text
 * prefix. Registered globally via `app.useLogger()` in `main.ts`.
 */
export class RequestContextLogger extends ConsoleLogger {
  constructor() {
    super({ json: true });
  }

  protected getJsonLogObject(
    message: unknown,
    options: {
      context: string;
      logLevel: LogLevel;
      writeStreamType?: 'stdout' | 'stderr';
      errorStack?: unknown;
    },
  ): JsonLogObject {
    const logObject = super.getJsonLogObject(message, options) as JsonLogObject;
    const requestId = requestContext.requestId;

    return requestId ? { ...logObject, requestId } : logObject;
  }
}
