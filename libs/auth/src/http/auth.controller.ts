import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from '../application/auth.service';
import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import { RefreshDto } from '../dto/refresh.dto';
import { RegisterResponseDto } from '../dto/register-response.dto';
import { AuthSessionResponseDto } from '../dto/auth-session-response.dto';
import { AuthenticatedUserResponseDto } from '../dto/authenticated-user-response.dto';
import { Public } from '../decorators/public.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../guards/jwt-auth.guard';
import type { RefreshTokenMetadata } from '../application/refresh-token.service';

/**
 * Not applied via a global guard — `apps/server` mounts pre-existing routes
 * (e.g. `AppController`) that must keep working unauthenticated. Protected
 * routes below opt in with `@UseGuards(JwtAuthGuard)` explicitly instead.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new account' })
  @ApiResponse({ status: 201, type: RegisterResponseDto })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    const user = await this.auth.register(dto);

    return { id: user.id, email: user.email };
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  @ApiOperation({ summary: 'Log in and receive an access + refresh token' })
  @ApiResponse({ status: 200, type: AuthSessionResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthSessionResponseDto> {
    return this.auth.login(dto, this.metadata(ip, userAgent));
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate a refresh token for a new session' })
  @ApiResponse({ status: 200, type: AuthSessionResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Refresh token invalid, expired, or reused',
  })
  refresh(
    @Body() dto: RefreshDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthSessionResponseDto> {
    return this.auth.refresh(dto.refreshToken, this.metadata(ip, userAgent));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Post('logout')
  @ApiOperation({ summary: 'Revoke the current session' })
  @ApiResponse({ status: 204, description: 'Session revoked' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RefreshDto,
  ): Promise<void> {
    await this.auth.logout(user.jti, user.tokenExpiresAt, dto.refreshToken);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Post('logout-all')
  @ApiOperation({ summary: 'Revoke every session for the current user' })
  @ApiResponse({ status: 204, description: 'All sessions revoked' })
  async logoutAll(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.auth.logoutAll(user.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({ summary: 'Get the current authenticated user' })
  @ApiResponse({ status: 200, type: AuthenticatedUserResponseDto })
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  /**
   * `RefreshTokenEntity.createdByIp`/`userAgent` exist for exactly this
   * purpose (see libs/auth/ARCH.md, Domain Model) but were previously never
   * populated — this is the only production caller of `login`/`refresh`,
   * so without wiring these here every stored refresh token had NULL
   * device/IP provenance, silently defeating the forensic value those
   * columns were designed for (e.g. spotting a stolen refresh token used
   * from an unfamiliar IP).
   */
  private metadata(ip: string, userAgent?: string): RefreshTokenMetadata {
    return userAgent === undefined
      ? { createdByIp: ip }
      : { createdByIp: ip, userAgent };
  }
}
