import { BadRequestException } from '@nestjs/common';

export class MfaAlreadyEnabledError extends BadRequestException {
  constructor() {
    super(
      'MFA is already enabled for this account — disable it first to re-enroll.',
    );
  }
}
