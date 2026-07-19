import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from '../application/auth.service';
import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import { RefreshDto } from '../dto/refresh.dto';
import { Public } from '../decorators/public.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../guards/jwt-auth.guard';

/**
 * Not applied via a global guard — `apps/server` mounts pre-existing routes
 * (e.g. `AppController`) that must keep working unauthenticated. Protected
 * routes below opt in with `@UseGuards(JwtAuthGuard)` explicitly instead.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    const user = await this.auth.register(dto);

    return { id: user.id, email: user.email };
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Post('logout')
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RefreshDto,
  ): Promise<void> {
    await this.auth.logout(user.jti, user.tokenExpiresAt, dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.auth.logoutAll(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
