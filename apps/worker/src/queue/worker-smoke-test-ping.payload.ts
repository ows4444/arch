import { IsString } from 'class-validator';

export class WorkerSmokeTestPingPayload {
  @IsString()
  message!: string;
}
