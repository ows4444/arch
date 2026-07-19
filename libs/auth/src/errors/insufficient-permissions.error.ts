import { ForbiddenException } from '@nestjs/common';

export class InsufficientPermissionsError extends ForbiddenException {
  constructor(permission: string) {
    super(`Missing required permission: ${permission}`);
  }
}
