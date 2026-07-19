import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthorizationService } from '../application/authorization.service';
import { CreateRoleDto } from '../dto/create-role.dto';
import { CreatePermissionDto } from '../dto/create-permission.dto';
import { RoleResponseDto } from '../dto/role-response.dto';
import { PermissionResponseDto } from '../dto/permission-response.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { Permissions } from '../decorators/permissions.decorator';

/**
 * Every route here requires the `roles:manage` permission — there is no
 * bootstrap magic that auto-grants it (e.g. "first registered user becomes
 * admin"), since that would be a real security decision made silently.
 * The initial `admin` role + `roles:manage` permission are seeded by
 * `1753100000000-SeedRolesManagePermission` migration; granting it to the
 * first real admin is a deliberate manual/ops step (see libs/auth/ARCH.md).
 */
@ApiTags('auth-rbac')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('auth')
export class RoleController {
  constructor(private readonly authorization: AuthorizationService) {}

  @Permissions('roles:manage')
  @Post('permissions')
  @ApiOperation({ summary: 'Create a permission' })
  @ApiResponse({ status: 201, type: PermissionResponseDto })
  @ApiResponse({ status: 409, description: 'Permission already exists' })
  createPermission(
    @Body() dto: CreatePermissionDto,
  ): Promise<PermissionResponseDto> {
    return this.authorization.createPermission(dto.name, dto.description);
  }

  @Permissions('roles:manage')
  @Post('roles')
  @ApiOperation({ summary: 'Create a role, optionally granting permissions' })
  @ApiResponse({ status: 201, type: RoleResponseDto })
  @ApiResponse({ status: 409, description: 'Role already exists' })
  @ApiResponse({
    status: 400,
    description: 'One of the requested permissions does not exist',
  })
  createRole(@Body() dto: CreateRoleDto): Promise<RoleResponseDto> {
    return this.authorization.createRole(dto.name, dto.permissions ?? []);
  }

  @Permissions('roles:manage')
  @Get('roles')
  @ApiOperation({ summary: 'List all roles and their granted permissions' })
  @ApiResponse({ status: 200, type: [RoleResponseDto] })
  listRoles(): Promise<RoleResponseDto[]> {
    return this.authorization.listRoles();
  }

  @Permissions('roles:manage')
  @HttpCode(204)
  @Post('users/:userId/roles/:roleName')
  @ApiOperation({ summary: 'Assign a role to a user' })
  @ApiResponse({ status: 204, description: 'Role assigned' })
  @ApiResponse({ status: 404, description: 'User or role not found' })
  async assignRole(
    @Param('userId') userId: string,
    @Param('roleName') roleName: string,
  ): Promise<void> {
    await this.authorization.assignRole(userId, roleName);
  }

  @Permissions('roles:manage')
  @HttpCode(204)
  @Delete('users/:userId/roles/:roleName')
  @ApiOperation({ summary: 'Revoke a role from a user' })
  @ApiResponse({ status: 204, description: 'Role revoked' })
  @ApiResponse({ status: 404, description: 'User or role not found' })
  async revokeRole(
    @Param('userId') userId: string,
    @Param('roleName') roleName: string,
  ): Promise<void> {
    await this.authorization.revokeRole(userId, roleName);
  }
}
