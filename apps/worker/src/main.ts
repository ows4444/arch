import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.create(WorkerModule);

  // Lets RMQConsumerRuntime.onApplicationShutdown drain in-flight messages before the process
  // exits, instead of dropping them mid-handling.
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.WORKER_PORT ?? 3001);
}
void bootstrap();
