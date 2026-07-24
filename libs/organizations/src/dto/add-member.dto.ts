import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';
import { MembershipRole } from '../domain/membership-role.enum';

export class AddMemberDto {
  @ApiProperty()
  @IsString()
  userId!: string;

  @ApiProperty({ enum: MembershipRole, default: MembershipRole.MEMBER })
  @IsEnum(MembershipRole)
  role!: MembershipRole;
}
