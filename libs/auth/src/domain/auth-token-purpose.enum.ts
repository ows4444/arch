export enum AuthTokenPurpose {
  PASSWORD_RESET = 'password-reset',
  EMAIL_VERIFICATION = 'email-verification',
  /** Short-lived, issued after password verification when MFA is enabled — consumed by `MfaService.verifyChallenge`. */
  MFA_CHALLENGE = 'mfa-challenge',
  /** Long-lived (effectively non-expiring until used/reissued) single-use backup code for MFA. */
  MFA_RECOVERY_CODE = 'mfa-recovery-code',
}
