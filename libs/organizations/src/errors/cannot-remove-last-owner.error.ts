import { ConflictException } from '@nestjs/common';

export class CannotRemoveLastOwnerError extends ConflictException {
  constructor() {
    super(
      'This organization has only one owner; remove or demote another owner first, or promote a replacement before removing this one.',
    );
  }
}
