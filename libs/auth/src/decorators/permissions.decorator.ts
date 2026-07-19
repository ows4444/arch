import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'auth:permissions';

export const Permissions = (
  ...permissions: string[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);
