import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MaxLength(512)
  refreshToken!: string;
}
