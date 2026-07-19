import { ConflictException } from '@nestjs/common';

export class RoleAlreadyExistsError extends ConflictException {
  constructor(name: string) {
    super(`Role '${name}' already exists.`);
  }
}
