import { InitialAuthSchema1753000000000 } from './1753000000000-InitialAuthSchema.migration';
import { SeedRolesManagePermission1753100000000 } from './1753100000000-SeedRolesManagePermission.migration';
import { AuthTokens1753200000000 } from './1753200000000-AuthTokens.migration';
import { RefreshTokenDeviceId1753300000000 } from './1753300000000-RefreshTokenDeviceId.migration';
import { MfaSecrets1753400000000 } from './1753400000000-MfaSecrets.migration';

export const AUTH_MIGRATIONS = [
  InitialAuthSchema1753000000000,
  SeedRolesManagePermission1753100000000,
  AuthTokens1753200000000,
  RefreshTokenDeviceId1753300000000,
  MfaSecrets1753400000000,
] as const;

export { InitialAuthSchema1753000000000 } from './1753000000000-InitialAuthSchema.migration';
export { SeedRolesManagePermission1753100000000 } from './1753100000000-SeedRolesManagePermission.migration';
export { AuthTokens1753200000000 } from './1753200000000-AuthTokens.migration';
export { RefreshTokenDeviceId1753300000000 } from './1753300000000-RefreshTokenDeviceId.migration';
export { MfaSecrets1753400000000 } from './1753400000000-MfaSecrets.migration';
