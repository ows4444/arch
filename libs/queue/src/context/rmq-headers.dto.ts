import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class RMQHeadersDto {
  @IsUUID()
  requestId!: string;

  @IsOptional()
  @IsUUID()
  correlationId?: string;

  @IsOptional()
  @IsUUID()
  causationId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  retryCount?: number;
}
