import { ApiProperty } from '@nestjs/swagger';

/** Swagger-only mirror of `AuthenticatedUser` (guards/jwt-auth.guard.ts) —
 * kept separate so the guard doesn't need to depend on `@nestjs/swagger`. */
export class AuthenticatedUserResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ type: [String] })
  roles!: string[];

  @ApiProperty({ type: [String] })
  permissions!: string[];

  @ApiProperty()
  jti!: string;

  @ApiProperty()
  tokenExpiresAt!: Date;
}
