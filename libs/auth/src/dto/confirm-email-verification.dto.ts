import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class ConfirmEmailVerificationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(256)
  token!: string;
}
