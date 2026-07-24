import { BadRequestException } from '@nestjs/common';

export class MfaEnrollmentNotPendingError extends BadRequestException {
  constructor() {
    super(
      'No pending MFA enrollment for this account — call beginEnrollment first.',
    );
  }
}
