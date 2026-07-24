import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { requestContext } from './request-context';

const REQUEST_ID_HEADER = 'x-request-id';

// Deliberately narrow — this value flows straight into every log line for
// the request (see RequestContextLogger), so an unvalidated caller-supplied
// header would be a log-injection vector (newlines, control characters, or
// an unbounded length). A `-`/`_`-separated alphanumeric string comfortably
// covers UUIDs and typical upstream trace-id formats.
const MAX_REQUEST_ID_LENGTH = 128;
const SAFE_REQUEST_ID = /^[a-zA-Z0-9_-]+$/;

function isSafeRequestId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_REQUEST_ID_LENGTH &&
    SAFE_REQUEST_ID.test(value)
  );
}

/**
 * Reuses an incoming `X-Request-Id` if the caller (e.g. an API gateway or a
 * load balancer) already supplied one *and* it's safe to log verbatim, so a
 * trace started upstream stays intact — otherwise generates a fresh one.
 * Echoes it back on the response so a client can report it, and stores it
 * in `requestContext` for the remainder of this request so every log line
 * emitted underneath (via `RequestContextLogger`) carries it automatically.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId =
      typeof incoming === 'string' && isSafeRequestId(incoming)
        ? incoming
        : randomUUID();

    res.setHeader('X-Request-Id', requestId);

    requestContext.run({ requestId }, next);
  }
}
