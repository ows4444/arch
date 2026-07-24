import { UnauthorizedException } from '@nestjs/common';

export class MfaCodeInvalidError extends UnauthorizedException {
  constructor() {
    super('The provided authentication code is invalid.');
  }
}
