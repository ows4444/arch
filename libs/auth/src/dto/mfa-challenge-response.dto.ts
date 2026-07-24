import { ApiProperty } from '@nestjs/swagger';

/**
 * Returned by `POST /auth/login` instead of `AuthSessionResponseDto` when
 * the account has MFA enabled. Exchange `challengeToken` (+ a TOTP/
 * recovery code) via `POST /auth/mfa/verify` for a real session.
 */
export class MfaChallengeResponseDto {
  @ApiProperty({ enum: [true] })
  mfaRequired!: true;

  @ApiProperty()
  challengeToken!: string;

  @ApiProperty()
  challengeExpiresAt!: Date;
}
