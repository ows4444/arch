import { UnauthorizedException } from '@nestjs/common';

export class TokenRevokedError extends UnauthorizedException {
  constructor(message = 'This token has been revoked.') {
    super(message);
  }
}
