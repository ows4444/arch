import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Acme Inc.' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
}
