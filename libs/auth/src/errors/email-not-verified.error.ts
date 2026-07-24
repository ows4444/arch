import { UnauthorizedException } from '@nestjs/common';

export class EmailNotVerifiedError extends UnauthorizedException {
  constructor() {
    super('Please verify your email address before logging in.');
  }
}
