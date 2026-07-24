import { RequestContextLogger } from './request-context-logger';
import { requestContext } from './request-context';

function capture(fn: () => void): unknown {
  const chunks: string[] = [];
  const spy = jest
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(chunk.toString());
      return true;
    });

  try {
    fn();
  } finally {
    spy.mockRestore();
  }

  return JSON.parse(chunks.join(''));
}

describe('RequestContextLogger', () => {
  it('logs structured JSON with no requestId field when no request is in scope', () => {
    const logger = new RequestContextLogger();

    const logObject = capture(() => logger.log('hello world', 'ctx'));

    expect(logObject).toMatchObject({
      level: 'log',
      message: 'hello world',
      context: 'ctx',
    });
    expect(logObject).not.toHaveProperty('requestId');
  });

  it('merges the active request id into the logged JSON object', () => {
    const logger = new RequestContextLogger();

    const logObject = requestContext.run({ requestId: 'req-42' }, () =>
      capture(() => logger.log('hello world', 'ctx')),
    );

    expect(logObject).toMatchObject({ requestId: 'req-42' });
  });

  it('does not leak a request id from a previous call into a later, context-free call', () => {
    const logger = new RequestContextLogger();

    requestContext.run({ requestId: 'req-1' }, () =>
      capture(() => logger.log('hello world', 'ctx')),
    );

    const logObject = capture(() => logger.log('hello world', 'ctx'));

    expect(logObject).not.toHaveProperty('requestId');
  });
});
