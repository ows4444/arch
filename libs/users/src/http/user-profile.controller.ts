import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@/auth';
import { UserProfileService } from '../application/user-profile.service';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { UserProfileResponseDto } from '../dto/user-profile-response.dto';

/**
 * `PATCH /users/me` never accepts a target user id from the client (body,
 * query, or param) — the target is always the caller's own `userId`, taken
 * from the verified JWT. This closes the class of bug where a client edits
 * someone else's profile by passing a different id in the payload (see
 * `libs/users/ARCH.md` Design 001, Security Architecture).
 */
@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UserProfileController {
  constructor(private readonly profiles: UserProfileService) {}

  @Get('me')
  @ApiOperation({ summary: "Get the caller's own profile" })
  @ApiResponse({ status: 200, type: UserProfileResponseDto })
  getMine(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserProfileResponseDto> {
    return this.profiles.getOrCreateMine(user.userId);
  }

  @Patch('me')
  @ApiOperation({ summary: "Update the caller's own profile" })
  @ApiResponse({ status: 200, type: UserProfileResponseDto })
  updateMine(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfileResponseDto> {
    return this.profiles.updateMine(user.userId, dto);
  }

  @Get(':userId')
  @ApiOperation({
    summary: 'Get another user’s profile',
    description:
      "Requires the 'users:manage' permission unless :userId is the caller's own id.",
  })
  @ApiResponse({ status: 200, type: UserProfileResponseDto })
  @ApiResponse({
    status: 403,
    description: 'Not the owner and lacks users:manage',
  })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  getForUser(
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserProfileResponseDto> {
    return this.profiles.getForUser(userId, user.userId);
  }
}
