import type { Channel, ConsumeMessage } from 'amqplib';
import { MessageSettlement } from './message-settlement';

function fakeMessage(): ConsumeMessage {
  return {
    properties: { messageId: 'msg-1' },
    fields: { routingKey: 'rk' },
  } as unknown as ConsumeMessage;
}

function fakeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    ack: jest.fn(),
    nack: jest.fn(),
    ...overrides,
  } as unknown as Channel;
}

describe('MessageSettlement.ack', () => {
  it('acks the message on the channel', () => {
    const channel = fakeChannel();
    const message = fakeMessage();

    new MessageSettlement(channel, message).ack();

    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('is a no-op on a second ack call', () => {
    const channel = fakeChannel();
    const settlement = new MessageSettlement(channel, fakeMessage());

    settlement.ack();
    settlement.ack();

    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it('does not allow nack after ack', () => {
    const channel = fakeChannel();
    const settlement = new MessageSettlement(channel, fakeMessage());

    settlement.ack();
    settlement.nack(true);

    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('propagates and rethrows an error from the underlying channel', () => {
    const channel = fakeChannel({
      ack: jest.fn(() => {
        throw new Error('channel closed');
      }),
    });

    expect(() => new MessageSettlement(channel, fakeMessage()).ack()).toThrow(
      'channel closed',
    );
  });
});

describe('MessageSettlement.nack', () => {
  it('nacks without requeue by default', () => {
    const channel = fakeChannel();
    const message = fakeMessage();

    new MessageSettlement(channel, message).nack();

    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
  });

  it('nacks with requeue when requested', () => {
    const channel = fakeChannel();
    const message = fakeMessage();

    new MessageSettlement(channel, message).nack(true);

    expect(channel.nack).toHaveBeenCalledWith(message, false, true);
  });

  it('is a no-op on a second nack call', () => {
    const channel = fakeChannel();
    const settlement = new MessageSettlement(channel, fakeMessage());

    settlement.nack();
    settlement.nack();

    expect(channel.nack).toHaveBeenCalledTimes(1);
  });

  it('propagates and rethrows an error from the underlying channel', () => {
    const channel = fakeChannel({
      nack: jest.fn(() => {
        throw new Error('channel closed');
      }),
    });

    expect(() => new MessageSettlement(channel, fakeMessage()).nack()).toThrow(
      'channel closed',
    );
  });
});
