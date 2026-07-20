import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, PermissionsGuard, Permissions } from '@/auth';
import { ValidationRuleAdminService } from '@/validation';
import { CreateValidationRuleDto } from './create-validation-rule.dto';
import { UpdateValidationRuleDto } from './update-validation-rule.dto';
import { ValidationRuleResponseDto } from './validation-rule-response.dto';

@ApiTags('validation-rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('validation-rules')
export class ValidationRuleController {
  constructor(private readonly admin: ValidationRuleAdminService) {}

  @Permissions('validation-rules:manage')
  @Post()
  @ApiOperation({ summary: 'Create a stored validation rule' })
  @ApiResponse({ status: 201, type: ValidationRuleResponseDto })
  async create(
    @Body() dto: CreateValidationRuleDto,
  ): Promise<ValidationRuleResponseDto> {
    const rule = await this.admin.create(dto);

    return ValidationRuleResponseDto.fromEntity(rule);
  }

  @Permissions('validation-rules:manage')
  @Get()
  @ApiOperation({
    summary: 'List stored validation rules, optionally by target type',
  })
  @ApiResponse({ status: 200, type: [ValidationRuleResponseDto] })
  async list(
    @Query('targetType') targetType?: string,
  ): Promise<ValidationRuleResponseDto[]> {
    const rules = await this.admin.list(targetType);

    return rules.map((rule) => ValidationRuleResponseDto.fromEntity(rule));
  }

  @Permissions('validation-rules:manage')
  @Get(':id')
  @ApiOperation({ summary: 'Get a stored validation rule by id' })
  @ApiResponse({ status: 200, type: ValidationRuleResponseDto })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ValidationRuleResponseDto> {
    const rule = await this.admin.findOne(id);

    return ValidationRuleResponseDto.fromEntity(rule);
  }

  @Permissions('validation-rules:manage')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a stored validation rule' })
  @ApiResponse({ status: 200, type: ValidationRuleResponseDto })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateValidationRuleDto,
  ): Promise<ValidationRuleResponseDto> {
    const rule = await this.admin.update(id, dto);

    return ValidationRuleResponseDto.fromEntity(rule);
  }

  @Permissions('validation-rules:manage')
  @HttpCode(204)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a stored validation rule' })
  @ApiResponse({ status: 204, description: 'Rule deleted' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.admin.remove(id);
  }
}
