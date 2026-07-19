import { ConflictException } from '@nestjs/common';

export class PermissionAlreadyExistsError extends ConflictException {
  constructor(name: string) {
    super(`Permission '${name}' already exists.`);
  }
}
