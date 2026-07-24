import { UnauthorizedException } from '@nestjs/common';

export class MfaChallengeInvalidError extends UnauthorizedException {
  constructor() {
    super('This MFA challenge is invalid, expired, or already used.');
  }
}
