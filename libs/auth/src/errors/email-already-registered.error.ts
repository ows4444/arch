import { ConflictException } from '@nestjs/common';

export class EmailAlreadyRegisteredError extends ConflictException {
  constructor() {
    super('An account with this email already exists.');
  }
}
