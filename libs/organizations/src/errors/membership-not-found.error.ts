import { NotFoundException } from '@nestjs/common';

export class MembershipNotFoundError extends NotFoundException {
  constructor(organizationId: string, userId: string) {
    super(
      `User '${userId}' is not a member of organization '${organizationId}'.`,
    );
  }
}
