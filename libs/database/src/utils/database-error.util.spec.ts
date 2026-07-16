import { isDatabaseConnectivityError } from './database-error.util';

const CONNECTIVITY_CODES = [
  'ECONNREFUSED',
  'ECONNRESET',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT',
  'ETIMEDOUT',
  'ER_CON_COUNT_ERROR',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'PROTOCOL_PACKETS_OUT_OF_ORDER',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ER_SERVER_SHUTDOWN',
];

describe('isDatabaseConnectivityError', () => {
  describe.each(CONNECTIVITY_CODES)('code %s', (code) => {
    it('returns true', () => {
      expect(isDatabaseConnectivityError({ code })).toBe(true);
    });
  });

  it.each(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'])(
    'returns false for a non-matching code %s',
    (code) => {
      expect(isDatabaseConnectivityError({ code })).toBe(false);
    },
  );

  it('returns false for a plain Error with no code', () => {
    expect(isDatabaseConnectivityError(new Error('boom'))).toBe(false);
  });

  it('returns false for undefined/null', () => {
    expect(isDatabaseConnectivityError(undefined)).toBe(false);
    expect(isDatabaseConnectivityError(null)).toBe(false);
  });

  it('returns true for an AggregateError containing at least one connectivity error', () => {
    const aggregate = new AggregateError(
      [new Error('unrelated'), { code: 'ECONNREFUSED' }],
      'combined failure',
    );

    expect(isDatabaseConnectivityError(aggregate)).toBe(true);
  });

  it('returns false for an AggregateError where none of the errors are connectivity errors', () => {
    const aggregate = new AggregateError(
      [new Error('unrelated'), { code: 'ER_LOCK_DEADLOCK' }],
      'combined failure',
    );

    expect(isDatabaseConnectivityError(aggregate)).toBe(false);
  });

  it('recurses through nested AggregateErrors', () => {
    const nested = new AggregateError(
      [{ code: 'ETIMEDOUT' }],
      'nested failure',
    );
    const aggregate = new AggregateError([nested], 'outer failure');

    expect(isDatabaseConnectivityError(aggregate)).toBe(true);
  });
});
