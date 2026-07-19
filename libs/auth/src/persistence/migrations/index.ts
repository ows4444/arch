import { InitialAuthSchema1753000000000 } from './1753000000000-InitialAuthSchema.migration';
import { SeedRolesManagePermission1753100000000 } from './1753100000000-SeedRolesManagePermission.migration';

export const AUTH_MIGRATIONS = [
  InitialAuthSchema1753000000000,
  SeedRolesManagePermission1753100000000,
] as const;

export { InitialAuthSchema1753000000000 } from './1753000000000-InitialAuthSchema.migration';
export { SeedRolesManagePermission1753100000000 } from './1753100000000-SeedRolesManagePermission.migration';
