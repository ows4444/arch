import { WorkerController } from './worker.controller';
import { WorkerService } from './worker.service';

describe('WorkerController', () => {
  function setup() {
    const outbox = { enqueue: jest.fn() };
    const controller = new WorkerController(
      new WorkerService(),
      outbox as never,
    );

    return { controller, outbox };
  }

  describe('root', () => {
    it('should return "Hello World!"', () => {
      const { controller } = setup();
      expect(controller.getHello()).toBe('Hello World!');
    });
  });

  describe('ping', () => {
    it('enqueues a smoke-test message on the worker smoke-test topology', async () => {
      const { controller, outbox } = setup();
      outbox.enqueue.mockResolvedValue('message-id-1');

      const result = await controller.ping({ message: 'hello' });

      expect(outbox.enqueue).toHaveBeenCalledWith({
        exchange: 'worker.smoke-test',
        routingKey: 'worker.smoke-test.ping',
        payload: { message: 'hello' },
      });
      expect(result).toEqual({ messageId: 'message-id-1' });
    });
  });
});
