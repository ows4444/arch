import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class DisableMfaDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  password!: string;
}
