import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsString } from 'class-validator';
import { OutboxService } from '@/queue';
import { WorkerService } from './worker.service';
import { WORKER_SMOKE_TEST_TOPOLOGY } from './queue/worker-smoke-test.topology';

class PingSmokeTestDto {
  @IsString()
  message!: string;
}

@Controller()
export class WorkerController {
  constructor(
    private readonly workerService: WorkerService,
    private readonly outbox: OutboxService,
  ) {}

  @Get()
  getHello(): string {
    return this.workerService.getHello();
  }

  /**
   * Manually triggers the outbox → RabbitMQ → WorkerSmokeTestConsumer → inbox pipeline, so the
   * wiring can be exercised on demand instead of firing automatically on every boot. See
   * apps/worker/LOOP.md, Loop 002.
   */
  @Post('smoke-test/ping')
  async ping(@Body() dto: PingSmokeTestDto): Promise<{ messageId: string }> {
    const messageId = await this.outbox.enqueue({
      exchange: WORKER_SMOKE_TEST_TOPOLOGY.QUEUES.ping.EXCHANGE_NAME,
      routingKey: WORKER_SMOKE_TEST_TOPOLOGY.QUEUES.ping.ROUTING_KEY,
      payload: { message: dto.message },
    });

    return { messageId };
  }
}
