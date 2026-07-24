import { NotFoundException } from '@nestjs/common';

export class SessionNotFoundError extends NotFoundException {
  constructor(sessionId: string) {
    super(`Session '${sessionId}' does not exist.`);
  }
}
