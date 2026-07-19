import { ApiProperty } from '@nestjs/swagger';

/** Swagger-only mirror of `AuthSession` (application/auth.service.ts) — kept
 * separate so the application layer isn't forced to depend on `@nestjs/swagger`. */
export class AuthSessionResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  accessTokenExpiresAt!: Date;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty()
  refreshTokenExpiresAt!: Date;
}
