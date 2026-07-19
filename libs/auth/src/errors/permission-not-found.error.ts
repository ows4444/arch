import { BadRequestException } from '@nestjs/common';

export class PermissionNotFoundError extends BadRequestException {
  constructor(name: string) {
    super(`Permission '${name}' does not exist — create it first.`);
  }
}
