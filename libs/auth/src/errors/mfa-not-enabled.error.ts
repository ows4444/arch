import { BadRequestException } from '@nestjs/common';

export class MfaNotEnabledError extends BadRequestException {
  constructor() {
    super('MFA is not enabled for this account.');
  }
}
