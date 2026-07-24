import { UserEntity } from '../../domain/user.entity';
import { RoleEntity } from '../../domain/role.entity';
import { PermissionEntity } from '../../domain/permission.entity';
import { RefreshTokenEntity } from '../../domain/refresh-token.entity';
import { AuthTokenEntity } from '../../domain/auth-token.entity';

export const AUTH_TYPEORM_ENTITIES = [
  UserEntity,
  RoleEntity,
  PermissionEntity,
  RefreshTokenEntity,
  AuthTokenEntity,
] as const;

export { UserEntity } from '../../domain/user.entity';
export { RoleEntity } from '../../domain/role.entity';
export { PermissionEntity } from '../../domain/permission.entity';
export { RefreshTokenEntity } from '../../domain/refresh-token.entity';
export { AuthTokenEntity } from '../../domain/auth-token.entity';
