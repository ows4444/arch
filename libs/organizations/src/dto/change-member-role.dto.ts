import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { MembershipRole } from '../domain/membership-role.enum';

export class ChangeMemberRoleDto {
  @ApiProperty({ enum: MembershipRole })
  @IsEnum(MembershipRole)
  role!: MembershipRole;
}
