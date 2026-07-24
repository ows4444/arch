import { NotFoundException } from '@nestjs/common';

export class OrganizationNotFoundError extends NotFoundException {
  constructor(organizationId: string) {
    super(`No organization exists with id '${organizationId}'.`);
  }
}
