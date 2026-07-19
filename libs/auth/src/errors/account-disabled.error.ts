import { UnauthorizedException } from '@nestjs/common';

export class AccountDisabledError extends UnauthorizedException {
  constructor() {
    super('This account has been disabled.');
  }
}
