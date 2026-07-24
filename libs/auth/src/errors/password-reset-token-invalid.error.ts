import { UnauthorizedException } from '@nestjs/common';

export class PasswordResetTokenInvalidError extends UnauthorizedException {
  constructor() {
    super('This password reset link is invalid, expired, or already used.');
  }
}
