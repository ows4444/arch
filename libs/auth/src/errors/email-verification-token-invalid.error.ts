import { UnauthorizedException } from '@nestjs/common';

export class EmailVerificationTokenInvalidError extends UnauthorizedException {
  constructor() {
    super('This verification link is invalid, expired, or already used.');
  }
}
