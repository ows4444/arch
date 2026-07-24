import { ConflictException } from '@nestjs/common';

export class AlreadyAMemberError extends ConflictException {
  constructor(organizationId: string, userId: string) {
    super(
      `User '${userId}' is already a member of organization '${organizationId}'.`,
    );
  }
}
