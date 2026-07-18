import { assertEntityName, queue, retry } from './topology.contracts';
import { QueueConfigurationError } from '../errors/queue-configuration.error';

describe('retry', () => {
  it('returns the strategy unchanged when valid', () => {
    expect(retry({ strategy: [5, 30, 120] })).toEqual({
      strategy: [5, 30, 120],
    });
  });

  it('throws for an empty strategy', () => {
    expect(() => retry({ strategy: [] })).toThrow(QueueConfigurationError);
  });

  it('throws for a non-integer delay', () => {
    expect(() => retry({ strategy: [5.5] })).toThrow(QueueConfigurationError);
  });

  it('throws for a zero or negative delay', () => {
    expect(() => retry({ strategy: [0] })).toThrow(QueueConfigurationError);
    expect(() => retry({ strategy: [-5] })).toThrow(QueueConfigurationError);
  });

  it('throws for a delay exceeding the maximum', () => {
    expect(() => retry({ strategy: [3_000_000] })).toThrow(
      QueueConfigurationError,
    );
  });

  it('throws when delays are not strictly increasing', () => {
    expect(() => retry({ strategy: [30, 30] })).toThrow(
      QueueConfigurationError,
    );
    expect(() => retry({ strategy: [30, 10] })).toThrow(
      QueueConfigurationError,
    );
  });
});

describe('queue', () => {
  it('returns the options unchanged', () => {
    const options = { routingKey: 'rk', durable: false };

    expect(queue(options)).toBe(options);
  });
});

describe('assertEntityName', () => {
  it('does not throw for a valid name', () => {
    expect(() => assertEntityName('orders', 'Exchange')).not.toThrow();
  });

  it('throws for an empty or whitespace-only name', () => {
    expect(() => assertEntityName('', 'Exchange')).toThrow(
      QueueConfigurationError,
    );
    expect(() => assertEntityName('   ', 'Exchange')).toThrow(
      QueueConfigurationError,
    );
  });

  it('throws when the name exceeds the RabbitMQ byte limit', () => {
    expect(() => assertEntityName('x'.repeat(256), 'Exchange')).toThrow(
      QueueConfigurationError,
    );
  });
});
