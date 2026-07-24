import { ForbiddenException } from '@nestjs/common';

export class ForbiddenProfileAccessError extends ForbiddenException {
  constructor() {
    super('You do not have permission to access this profile.');
  }
}
