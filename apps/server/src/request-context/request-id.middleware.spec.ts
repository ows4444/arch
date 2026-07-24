import type { Request, Response } from 'express';
import { RequestIdMiddleware } from './request-id.middleware';
import { requestContext } from './request-context';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fakeRequest(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function fakeResponse() {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
  };

  return { res: res as unknown as Response, headers };
}

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
  });

  it('generates a UUID and sets it on the response when no header is supplied', () => {
    const req = fakeRequest();
    const { res, headers } = fakeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(headers['X-Request-Id']).toMatch(UUID_PATTERN);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reuses a safe caller-supplied X-Request-Id verbatim', () => {
    const req = fakeRequest({ 'x-request-id': 'upstream-trace-abc_123' });
    const { res, headers } = fakeResponse();

    middleware.use(req, res, jest.fn());

    expect(headers['X-Request-Id']).toBe('upstream-trace-abc_123');
  });

  it('generates a fresh id when the header contains unsafe characters', () => {
    const req = fakeRequest({
      'x-request-id': 'evil\n[FAKE LOG LINE] rm -rf /',
    });
    const { res, headers } = fakeResponse();

    middleware.use(req, res, jest.fn());

    expect(headers['X-Request-Id']).toMatch(UUID_PATTERN);
  });

  it('generates a fresh id when the header exceeds the length cap', () => {
    const req = fakeRequest({ 'x-request-id': 'a'.repeat(200) });
    const { res, headers } = fakeResponse();

    middleware.use(req, res, jest.fn());

    expect(headers['X-Request-Id']).toMatch(UUID_PATTERN);
  });

  it('generates a fresh id when the header is an empty string', () => {
    const req = fakeRequest({ 'x-request-id': '' });
    const { res, headers } = fakeResponse();

    middleware.use(req, res, jest.fn());

    expect(headers['X-Request-Id']).toMatch(UUID_PATTERN);
  });

  it('makes the request id available via requestContext for the duration of next()', () => {
    const req = fakeRequest({ 'x-request-id': 'trace-during-next' });
    const { res } = fakeResponse();
    let seenDuringNext: string | undefined;

    middleware.use(req, res, () => {
      seenDuringNext = requestContext.requestId;
    });

    expect(seenDuringNext).toBe('trace-during-next');
    expect(requestContext.requestId).toBeUndefined();
  });
});
