import { ForbiddenException } from '@nestjs/common';

export class InsufficientRoleError extends ForbiddenException {
  constructor(role: string) {
    super(`Missing required role: ${role}`);
  }
}
