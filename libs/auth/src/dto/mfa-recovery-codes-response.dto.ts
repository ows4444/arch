import { ApiProperty } from '@nestjs/swagger';

export class MfaRecoveryCodesResponseDto {
  @ApiProperty({
    type: [String],
    description:
      'Single-use backup codes, shown exactly once — store them somewhere safe. Each is invalidated after use, or all at once if MFA is disabled/re-enrolled.',
  })
  recoveryCodes!: string[];
}
