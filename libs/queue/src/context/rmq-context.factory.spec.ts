import type { ConsumeMessage } from 'amqplib';
import { RMQContextFactory } from './rmq-context.factory';
import { RMQ_HEADERS } from '../queue.constants';

const REQUEST_ID = '6e32be35-96d6-4cc8-9d4a-22bb9ac7edd9';

function fakeMessage(
  overrides: Partial<ConsumeMessage['properties']> = {},
): ConsumeMessage {
  return {
    properties: {
      messageId: 'msg-1',
      headers: { [RMQ_HEADERS.REQUEST_ID]: REQUEST_ID },
      ...overrides,
    },
    fields: { routingKey: 'rk', exchange: 'ex' },
  } as unknown as ConsumeMessage;
}

describe('RMQContextFactory.create', () => {
  it('builds a context from the message properties/fields', () => {
    const factory = new RMQContextFactory();
    const signal = new AbortController().signal;

    const context = factory.create({
      message: fakeMessage(),
      queue: 'q1',
      signal,
    });

    expect(context).toMatchObject({
      messageId: 'msg-1',
      requestId: REQUEST_ID,
      routingKey: 'rk',
      exchange: 'ex',
      queue: 'q1',
      signal,
    });
    expect(context.receivedAt).toEqual(expect.any(Number));
  });

  it('leaves messageId undefined when the broker did not set one', () => {
    const factory = new RMQContextFactory();

    const context = factory.create({
      message: fakeMessage({ messageId: undefined }),
      queue: 'q1',
      signal: new AbortController().signal,
    });

    expect(context.messageId).toBeUndefined();
  });
});
