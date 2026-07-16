import { RMQPublisher } from './rmq.publisher';
import { RMQConnection } from '../connection/rmq.connection';
import { RMQ_HEADERS } from '../queue.constants';

const REQUEST_ID = '6e32be35-96d6-4cc8-9d4a-22bb9ac7edd9';

type ReturnHandler = (message: {
  fields: { exchange: string; routingKey: string };
  properties: { messageId: string };
}) => void;

function fakeConnection(
  publish: jest.Mock,
  captureReturnHandler?: (handler: ReturnHandler) => void,
): RMQConnection {
  return {
    createChannel: jest.fn().mockReturnValue({
      on: jest.fn((event: string, handler: ReturnHandler) => {
        if (event === 'return') {
          captureReturnHandler?.(handler);
        }
      }),
      publish,
    }),
  } as unknown as RMQConnection;
}

describe('RMQPublisher', () => {
  it('publishes with the system trace headers set', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const publisher = new RMQPublisher(fakeConnection(publish));

    await publisher.publish(
      { EXCHANGE_NAME: 'ex', ROUTING_KEY: 'rk' },
      { a: 1 },
      { messageId: 'm1', requestId: REQUEST_ID },
    );

    const [, , , options] = publish.mock.calls[0] as [
      string,
      string,
      Buffer,
      { headers: Record<string, unknown> },
    ];

    expect(options.headers[RMQ_HEADERS.REQUEST_ID]).toBe(REQUEST_ID);
  });

  it('strips a caller-supplied x-retry-count header instead of forwarding it', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const publisher = new RMQPublisher(fakeConnection(publish));

    await publisher.publish(
      { EXCHANGE_NAME: 'ex', ROUTING_KEY: 'rk' },
      { a: 1 },
      {
        messageId: 'm1',
        requestId: REQUEST_ID,
        options: {
          headers: {
            [RMQ_HEADERS.RETRY_COUNT]: 999,
          },
        },
      },
    );

    const [, , , options] = publish.mock.calls[0] as [
      string,
      string,
      Buffer,
      { headers: Record<string, unknown> },
    ];

    expect(options.headers[RMQ_HEADERS.RETRY_COUNT]).toBeUndefined();
  });

  it('sets the retry-count header only via the dedicated retryCount parameter', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const publisher = new RMQPublisher(fakeConnection(publish));

    await publisher.publish(
      { EXCHANGE_NAME: 'ex', ROUTING_KEY: 'rk' },
      { a: 1 },
      {
        messageId: 'm1',
        requestId: REQUEST_ID,
        retryCount: 3,
        options: {
          headers: {
            [RMQ_HEADERS.RETRY_COUNT]: 999,
          },
        },
      },
    );

    const [, , , options] = publish.mock.calls[0] as [
      string,
      string,
      Buffer,
      { headers: Record<string, unknown> },
    ];

    expect(options.headers[RMQ_HEADERS.RETRY_COUNT]).toBe(3);
  });

  it('preserves other caller-supplied headers untouched', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const publisher = new RMQPublisher(fakeConnection(publish));

    await publisher.publish(
      { EXCHANGE_NAME: 'ex', ROUTING_KEY: 'rk' },
      { a: 1 },
      {
        messageId: 'm1',
        requestId: REQUEST_ID,
        options: {
          headers: {
            'x-custom-header': 'value',
          },
        },
      },
    );

    const [, , , options] = publish.mock.calls[0] as [
      string,
      string,
      Buffer,
      { headers: Record<string, unknown> },
    ];

    expect(options.headers['x-custom-header']).toBe('value');
  });

  it('rejects when the broker returns the message as unroutable (regression)', async () => {
    let returnHandler: ReturnHandler | undefined;
    const publish = jest.fn().mockImplementation(() => {
      returnHandler?.({
        fields: { exchange: 'ex', routingKey: 'rk' },
        properties: { messageId: 'm1' },
      });
      return Promise.resolve();
    });
    const publisher = new RMQPublisher(
      fakeConnection(publish, (handler) => {
        returnHandler = handler;
      }),
    );

    await expect(
      publisher.publish(
        { EXCHANGE_NAME: 'ex', ROUTING_KEY: 'rk' },
        { a: 1 },
        { messageId: 'm1', requestId: REQUEST_ID },
      ),
    ).rejects.toThrow(/could not be routed/);
  });

  it('resolves normally when the message is routable (no return event)', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const publisher = new RMQPublisher(fakeConnection(publish));

    await expect(
      publisher.publish(
        { EXCHANGE_NAME: 'ex', ROUTING_KEY: 'rk' },
        { a: 1 },
        { messageId: 'm1', requestId: REQUEST_ID },
      ),
    ).resolves.toBeUndefined();
  });

  it('does not let a return event for a different messageId affect this publish', async () => {
    let returnHandler: ReturnHandler | undefined;
    const publish = jest.fn().mockImplementation(() => {
      returnHandler?.({
        fields: { exchange: 'ex', routingKey: 'rk' },
        properties: { messageId: 'a-different-message' },
      });
      return Promise.resolve();
    });
    const publisher = new RMQPublisher(
      fakeConnection(publish, (handler) => {
        returnHandler = handler;
      }),
    );

    await expect(
      publisher.publish(
        { EXCHANGE_NAME: 'ex', ROUTING_KEY: 'rk' },
        { a: 1 },
        { messageId: 'm1', requestId: REQUEST_ID },
      ),
    ).resolves.toBeUndefined();
  });
});
