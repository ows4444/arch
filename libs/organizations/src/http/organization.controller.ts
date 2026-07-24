import {
  Body,
  Controller,
  Delete,
  Get,
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
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@/auth';
import { OrganizationService } from '../application/organization.service';
import { CreateOrganizationDto } from '../dto/create-organization.dto';
import { OrganizationResponseDto } from '../dto/organization-response.dto';

@ApiTags('organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations')
export class OrganizationController {
  constructor(private readonly organizations: OrganizationService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an organization',
    description: 'The caller becomes its first owner.',
  })
  @ApiResponse({ status: 201, type: OrganizationResponseDto })
  create(
    @Body() dto: CreateOrganizationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrganizationResponseDto> {
    return this.organizations.create(dto.name, user.userId);
  }

  @Get(':organizationId')
  @ApiOperation({ summary: 'Get an organization' })
  @ApiResponse({ status: 200, type: OrganizationResponseDto })
  @ApiResponse({
    status: 403,
    description: 'Not a member and lacks the platform override',
  })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  get(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrganizationResponseDto> {
    return this.organizations.get(organizationId, user.userId);
  }

  @Delete(':organizationId')
  @ApiOperation({
    summary: 'Delete an organization',
    description: 'Requires the owner role or the platform override.',
  })
  @ApiResponse({ status: 204 })
  async delete(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.organizations.delete(organizationId, user.userId);
  }
}
