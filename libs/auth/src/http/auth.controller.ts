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
import { PasswordResetService } from '../application/password-reset.service';
import { EmailVerificationService } from '../application/email-verification.service';
import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import { RefreshDto } from '../dto/refresh.dto';
import { RequestPasswordResetDto } from '../dto/request-password-reset.dto';
import { ConfirmPasswordResetDto } from '../dto/confirm-password-reset.dto';
import { RequestEmailVerificationDto } from '../dto/request-email-verification.dto';
import { ConfirmEmailVerificationDto } from '../dto/confirm-email-verification.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { RateLimit } from '@/ratelimit';
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
  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  @Public()
  @RateLimit('register')
  @Post('register')
  @ApiOperation({ summary: 'Register a new account' })
  @ApiResponse({ status: 201, type: RegisterResponseDto })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  @ApiResponse({ status: 429, description: 'Too many registration attempts' })
  async register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    const user = await this.auth.register(dto);

    return { id: user.id, email: user.email };
  }

  @Public()
  @RateLimit('login')
  @HttpCode(200)
  @Post('login')
  @ApiOperation({ summary: 'Log in and receive an access + refresh token' })
  @ApiResponse({ status: 200, type: AuthSessionResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Too many login attempts' })
  login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthSessionResponseDto> {
    return this.auth.login(dto, this.metadata(ip, userAgent, dto.deviceId));
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
    return this.auth.refresh(
      dto.refreshToken,
      this.metadata(ip, userAgent, dto.deviceId),
    );
  }

  @Public()
  @RateLimit('password-reset')
  @HttpCode(204)
  @Post('password-reset/request')
  @ApiOperation({
    summary: 'Request a password reset email',
    description:
      'Always responds 204 whether or not the email is registered, so the response never ' +
      'reveals account existence.',
  })
  @ApiResponse({ status: 204, description: 'Request accepted' })
  @ApiResponse({ status: 429, description: 'Too many reset requests' })
  async requestPasswordReset(
    @Body() dto: RequestPasswordResetDto,
  ): Promise<void> {
    await this.passwordReset.requestReset(dto.email);
  }

  @Public()
  @RateLimit('password-reset')
  @HttpCode(204)
  @Post('password-reset/confirm')
  @ApiOperation({
    summary: 'Complete a password reset, revoking every existing session',
  })
  @ApiResponse({ status: 204, description: 'Password reset' })
  @ApiResponse({
    status: 401,
    description: 'Reset token invalid, expired, or already used',
  })
  @ApiResponse({ status: 429, description: 'Too many reset attempts' })
  async confirmPasswordReset(
    @Body() dto: ConfirmPasswordResetDto,
  ): Promise<void> {
    await this.passwordReset.confirmReset(dto.token, dto.newPassword);
  }

  @Public()
  @RateLimit('email-verification')
  @HttpCode(204)
  @Post('email-verification/request')
  @ApiOperation({
    summary: 'Request (or resend) an email verification link',
    description:
      'Always responds 204 whether or not the email is registered or already verified, so the ' +
      'response never reveals account existence/state.',
  })
  @ApiResponse({ status: 204, description: 'Request accepted' })
  @ApiResponse({ status: 429, description: 'Too many verification requests' })
  async requestEmailVerification(
    @Body() dto: RequestEmailVerificationDto,
  ): Promise<void> {
    await this.emailVerification.requestVerification(dto.email);
  }

  @Public()
  @RateLimit('email-verification')
  @HttpCode(204)
  @Post('email-verification/confirm')
  @ApiOperation({ summary: 'Confirm an email verification link' })
  @ApiResponse({ status: 204, description: 'Email verified' })
  @ApiResponse({
    status: 401,
    description: 'Verification token invalid, expired, or already used',
  })
  @ApiResponse({ status: 429, description: 'Too many verification attempts' })
  async confirmEmailVerification(
    @Body() dto: ConfirmEmailVerificationDto,
  ): Promise<void> {
    await this.emailVerification.confirm(dto.token);
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
  @RateLimit('change-password')
  @HttpCode(204)
  @Post('change-password')
  @ApiOperation({
    summary:
      'Change password while authenticated, revoking every existing session',
  })
  @ApiResponse({ status: 204, description: 'Password changed' })
  @ApiResponse({ status: 401, description: 'Current password is incorrect' })
  @ApiResponse({ status: 429, description: 'Too many password changes' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(
      user.userId,
      dto.currentPassword,
      dto.newPassword,
    );
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
   * `RefreshTokenEntity.createdByIp`/`userAgent`/`deviceId` exist for
   * exactly this purpose (see libs/auth/ARCH.md, Domain Model) but
   * `createdByIp`/`userAgent` were previously never populated — this is the
   * only production caller of `login`/`refresh`, so without wiring these
   * here every stored refresh token had NULL device/IP provenance, silently
   * defeating the forensic value those columns were designed for (e.g.
   * spotting a stolen refresh token used from an unfamiliar IP). `deviceId`
   * is caller-supplied (the DTO's optional field) rather than derived here,
   * since — unlike IP/user-agent — it isn't observable from the request
   * itself.
   */
  private metadata(
    ip: string,
    userAgent?: string,
    deviceId?: string,
  ): RefreshTokenMetadata {
    return {
      createdByIp: ip,
      ...(userAgent === undefined ? {} : { userAgent }),
      ...(deviceId === undefined ? {} : { deviceId }),
    };
  }
}
