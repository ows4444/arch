import { IsOptional, IsString } from 'class-validator';

export class EmailMessagePayload {
  @IsString()
  to!: string;

  @IsString()
  subject!: string;

  @IsString()
  text!: string;

  @IsOptional()
  @IsString()
  html?: string;
}
