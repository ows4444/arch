import { ApiProperty } from '@nestjs/swagger';
import { MembershipRole } from '../domain/membership-role.enum';

export class MembershipResponseDto {
  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ enum: MembershipRole })
  role!: MembershipRole;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
