import { NotFoundException } from '@nestjs/common';

export class UserNotFoundError extends NotFoundException {
  constructor(userId: string) {
    super(`User '${userId}' does not exist.`);
  }
}
