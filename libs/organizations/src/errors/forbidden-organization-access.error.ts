import { ForbiddenException } from '@nestjs/common';

export class ForbiddenOrganizationAccessError extends ForbiddenException {
  constructor() {
    super('You do not have permission to perform this action.');
  }
}
