import { ApiProperty } from '@nestjs/swagger';
import { PermissionResponseDto } from './permission-response.dto';

export class RoleResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [PermissionResponseDto] })
  permissions!: PermissionResponseDto[];
}
