import { Expose } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class AuthEnvironmentSchema {
  @Expose()
  @IsString()
  @MinLength(32, {
    message: 'AUTH_JWT_SECRET must be at least 32 characters long.',
  })
  AUTH_JWT_SECRET!: string;

  @Expose()
  @IsInt()
  @Min(1)
  @Max(24 * 60 * 60)
  @IsOptional()
  AUTH_ACCESS_TOKEN_TTL_SECONDS!: number;

  @Expose()
  @IsInt()
  @Min(1)
  @IsOptional()
  AUTH_REFRESH_TOKEN_TTL_SECONDS!: number;

  /**
   * Encrypts TOTP secrets at rest (see `AesGcmMfaSecretCipher`). Optional —
   * MFA stays inert (fails only if actually used) until this is set, so
   * existing deployments don't need it just to boot.
   */
  @Expose()
  @IsString()
  @MinLength(32, {
    message: 'AUTH_MFA_ENCRYPTION_KEY must be at least 32 characters long.',
  })
  @IsOptional()
  AUTH_MFA_ENCRYPTION_KEY?: string;
}
