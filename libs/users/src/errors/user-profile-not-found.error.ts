import { NotFoundException } from '@nestjs/common';

export class UserProfileNotFoundError extends NotFoundException {
  constructor(userId: string) {
    super(`No profile exists for user '${userId}'.`);
  }
}
