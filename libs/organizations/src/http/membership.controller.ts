import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@/auth';
import { MembershipService } from '../application/membership.service';
import { AddMemberDto } from '../dto/add-member.dto';
import { ChangeMemberRoleDto } from '../dto/change-member-role.dto';
import { MembershipResponseDto } from '../dto/membership-response.dto';

@ApiTags('organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/members')
export class MembershipController {
  constructor(private readonly memberships: MembershipService) {}

  @Get()
  @ApiOperation({ summary: 'List an organization’s members' })
  @ApiResponse({ status: 200, type: [MembershipResponseDto] })
  list(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MembershipResponseDto[]> {
    return this.memberships.listMembers(organizationId, user.userId);
  }

  @Post()
  @ApiOperation({
    summary: 'Add a member',
    description:
      'Requires the admin or owner role. Only an owner may add another owner.',
  })
  @ApiResponse({ status: 201, type: MembershipResponseDto })
  @ApiResponse({ status: 409, description: 'Already a member' })
  addMember(
    @Param('organizationId') organizationId: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MembershipResponseDto> {
    return this.memberships.addMember(
      organizationId,
      dto.userId,
      dto.role,
      user.userId,
    );
  }

  @Patch(':userId')
  @ApiOperation({
    summary: 'Change a member’s role',
    description:
      'Requires the admin or owner role. An admin may never change an owner’s role, and only an owner may promote someone to owner.',
  })
  @ApiResponse({ status: 200, type: MembershipResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Would leave the organization with no owner',
  })
  changeRole(
    @Param('organizationId') organizationId: string,
    @Param('userId') userId: string,
    @Body() dto: ChangeMemberRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MembershipResponseDto> {
    return this.memberships.changeRole(
      organizationId,
      userId,
      dto.role,
      user.userId,
    );
  }

  @Delete(':userId')
  @ApiOperation({
    summary: 'Remove a member',
    description:
      'A member may always remove themselves. Removing someone else requires the admin or owner role, and an admin may never remove an owner.',
  })
  @ApiResponse({ status: 204 })
  @ApiResponse({
    status: 409,
    description: 'Would leave the organization with no owner',
  })
  async removeMember(
    @Param('organizationId') organizationId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.memberships.removeMember(organizationId, userId, user.userId);
  }
}
