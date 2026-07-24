import { connect } from 'amqplib';
import { RMQConnection } from './rmq.connection';
import { QueueConfigurationError } from '../errors/queue-configuration.error';
import type { QueueModuleOptions } from '../queue.types';

jest.mock('amqplib', () => ({
  connect: jest.fn(),
}));

jest.mock('amqp-connection-manager', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(() => ({
      on: jest.fn(),
      createChannel: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    })),
  },
}));

const mockedConnect = connect as jest.MockedFunction<typeof connect>;

function fakeChannelModel() {
  return {
    createChannel: jest.fn().mockResolvedValue({}),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

function baseOptions(): QueueModuleOptions {
  return { uri: 'amqp://localhost' };
}

describe('RMQConnection raw connection retry/backoff', () => {
  beforeEach(() => {
    mockedConnect.mockReset();
  });

  it('connects on the first attempt without retrying', async () => {
    const channelModel = fakeChannelModel();
    mockedConnect.mockResolvedValue(channelModel as never);

    const connection = new RMQConnection(baseOptions());

    await connection.createRawChannel();

    expect(mockedConnect).toHaveBeenCalledTimes(1);
  });

  it('retries after transient failures and eventually succeeds', async () => {
    jest.useFakeTimers();

    try {
      const channelModel = fakeChannelModel();
      mockedConnect
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(channelModel as never);

      const connection = new RMQConnection(baseOptions());

      const channelPromise = connection.createRawChannel();

      await jest.advanceTimersByTimeAsync(2_000);
      await jest.advanceTimersByTimeAsync(5_000);

      await channelPromise;

      expect(mockedConnect).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shares a single connection attempt across concurrent callers', async () => {
    const channelModel = fakeChannelModel();
    mockedConnect.mockResolvedValue(channelModel as never);

    const connection = new RMQConnection(baseOptions());

    await Promise.all([
      connection.createRawChannel(),
      connection.createRawChannel(),
    ]);

    expect(mockedConnect).toHaveBeenCalledTimes(1);
  });

  it('throws the last error after exhausting all retry attempts', async () => {
    jest.useFakeTimers();

    try {
      const finalError = new Error('ECONNREFUSED: final attempt');
      mockedConnect.mockRejectedValue(finalError);

      const connection = new RMQConnection(baseOptions());

      const channelPromise = connection.createRawChannel();
      const assertion = expect(channelPromise).rejects.toBe(finalError);

      await jest.advanceTimersByTimeAsync(5 * 60_000);

      await assertion;

      expect(mockedConnect).toHaveBeenCalledTimes(10);
    } finally {
      jest.useRealTimers();
    }
  });

  it('respects a configured rawConnectionMaxRetries instead of the library default', async () => {
    jest.useFakeTimers();

    try {
      const finalError = new Error('ECONNREFUSED: final attempt');
      mockedConnect.mockRejectedValue(finalError);

      const connection = new RMQConnection({
        ...baseOptions(),
        rawConnectionMaxRetries: 2,
      });

      const channelPromise = connection.createRawChannel();
      const assertion = expect(channelPromise).rejects.toBe(finalError);

      await jest.advanceTimersByTimeAsync(60_000);

      await assertion;

      expect(mockedConnect).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('RMQConnection.resolvePrefetch', () => {
  it('returns the explicit value when valid', () => {
    const connection = new RMQConnection(baseOptions());

    expect(connection.resolvePrefetch(5)).toBe(5);
  });

  it('falls back to the module-level default, then the library default', () => {
    const withModuleDefault = new RMQConnection({
      ...baseOptions(),
      prefetch: 20,
    });
    expect(withModuleDefault.resolvePrefetch()).toBe(20);

    const withoutModuleDefault = new RMQConnection(baseOptions());
    expect(withoutModuleDefault.resolvePrefetch()).toBe(10);
  });

  it('rejects a non-positive prefetch value', () => {
    const connection = new RMQConnection(baseOptions());

    expect(() => connection.resolvePrefetch(0)).toThrow(
      QueueConfigurationError,
    );
    expect(() => connection.resolvePrefetch(-1)).toThrow(
      QueueConfigurationError,
    );
  });

  it('rejects a prefetch value above the maximum', () => {
    const connection = new RMQConnection(baseOptions());

    expect(() => connection.resolvePrefetch(101)).toThrow(
      QueueConfigurationError,
    );
  });

  it('rejects a non-integer prefetch value', () => {
    const connection = new RMQConnection(baseOptions());

    expect(() => connection.resolvePrefetch(1.5)).toThrow(
      QueueConfigurationError,
    );
  });

  it('respects a configured maxPrefetch instead of the library default', () => {
    const connection = new RMQConnection({ ...baseOptions(), maxPrefetch: 5 });

    expect(connection.resolvePrefetch(5)).toBe(5);
    expect(() => connection.resolvePrefetch(6)).toThrow(
      QueueConfigurationError,
    );
  });
});
