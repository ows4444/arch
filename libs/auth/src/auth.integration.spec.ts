import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { DatabaseRole, RepositoryResolver } from '@/database';

type DataSourceManager = ConstructorParameters<typeof RepositoryResolver>[0];
import { UserRepository } from './domain/user.repository';
import { RoleRepository } from './domain/role.repository';
import { RefreshTokenRepository } from './domain/refresh-token.repository';
import { AUTH_TYPEORM_ENTITIES } from './persistence/entities';
import { AuthService } from './application/auth.service';
import { AuthorizationService } from './application/authorization.service';
import { TokenService } from './application/token.service';
import { RefreshTokenService } from './application/refresh-token.service';
import { Argon2PasswordHasher } from './adapters/argon2-password-hasher';
import { NoopAccessTokenDenylist } from './adapters/noop-access-token-denylist';
import { NoopAuthEventPublisher } from './adapters/noop-auth-event-publisher';
import { InvalidCredentialsError } from './errors/invalid-credentials.error';
import { TokenRevokedError } from './errors/token-revoked.error';
import type { AuthModuleOptions } from './auth.types';

/**
 * End-to-end against a real (in-memory sqlite) database and real
 * repositories/services — not mocks. Unlike the unit specs elsewhere in
 * this library, this exercises the things a mock can't catch: TypeORM's
 * many-to-many relation persistence for RBAC, and the atomic
 * `revokeIfActive` conditional UPDATE that
 * `RefreshTokenService.rotate`'s reuse-detection depends on.
 */
describe('libs/auth integration (real DataSource)', () => {
  let dataSource: DataSource;
  let userRepo: UserRepository;
  let roleRepo: RoleRepository;
  let refreshTokenRepo: RefreshTokenRepository;
  let authService: AuthService;
  let authorizationService: AuthorizationService;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [...AUTH_TYPEORM_ENTITIES],
      synchronize: true,
      dropSchema: true,
    });
    await dataSource.initialize();

    const dataSourceManager = {
      manager: () => dataSource.manager,
      dataSource: () => dataSource,
      repository: (entity: never) => dataSource.manager.getRepository(entity),
    } as unknown as DataSourceManager;

    const resolver = new RepositoryResolver(dataSourceManager);

    userRepo = new UserRepository(DatabaseRole.WRITE, resolver);
    roleRepo = new RoleRepository(DatabaseRole.WRITE, resolver);
    refreshTokenRepo = new RefreshTokenRepository(DatabaseRole.WRITE, resolver);

    const options: AuthModuleOptions = {
      jwt: { secret: 'integration-test-secret-value-1234567890' },
    };
    const tokenService = new TokenService(
      new JwtService({ secret: options.jwt.secret }),
      options,
    );
    const events = new NoopAuthEventPublisher();
    const refreshTokenService = new RefreshTokenService(
      refreshTokenRepo,
      options,
      events,
    );
    const passwordHasher = new Argon2PasswordHasher();
    const denylist = new NoopAccessTokenDenylist();

    authService = new AuthService(
      userRepo,
      tokenService,
      refreshTokenService,
      passwordHasher,
      events,
      denylist,
    );
    authorizationService = new AuthorizationService(userRepo, roleRepo);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('registers, logs in, and issues a real signed access token', async () => {
    await authService.register({
      email: 'alice@example.com',
      password: 'correct-horse-battery-staple',
    });

    const session = await authService.login({
      email: 'Alice@Example.com',
      password: 'correct-horse-battery-staple',
    });

    expect(session.accessToken.split('.')).toHaveLength(3);
    expect(session.refreshToken).toEqual(expect.any(String));

    const stored = await userRepo.findByEmail('alice@example.com');
    expect(stored?.passwordHash).not.toBe('correct-horse-battery-staple');
  });

  it('rejects login with the wrong password against a real hash', async () => {
    await authService.register({
      email: 'bob@example.com',
      password: 'correct-horse-battery-staple',
    });

    await expect(
      authService.login({ email: 'bob@example.com', password: 'wrong' }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('assigns a role via AuthorizationService and reflects it in a signed token/session', async () => {
    await authService.register({
      email: 'carol@example.com',
      password: 'correct-horse-battery-staple',
    });
    const user = await userRepo.findByEmail('carol@example.com');

    await roleRepo.save({ name: 'admin', permissions: [] });
    await authorizationService.assignRole(user!.id, 'admin');

    expect(
      await authorizationService.hasPermission(user!.id, 'workflow:read'),
    ).toBe(false);

    const reloaded = await userRepo.findByEmail('carol@example.com');
    expect(reloaded?.roles.map((role) => role.name)).toEqual(['admin']);
  });

  it('rotates a refresh token exactly once, then rejects reuse of the old one', async () => {
    await authService.register({
      email: 'dave@example.com',
      password: 'correct-horse-battery-staple',
    });
    const session = await authService.login({
      email: 'dave@example.com',
      password: 'correct-horse-battery-staple',
    });

    const rotated = await authService.refresh(session.refreshToken);
    expect(rotated.refreshToken).not.toBe(session.refreshToken);

    // Reusing the now-rotated-out original token must fail — this is the
    // atomic `revokeIfActive` compare-and-revoke path, exercised against a
    // real database rather than a mocked repository.
    await expect(authService.refresh(session.refreshToken)).rejects.toThrow(
      TokenRevokedError,
    );

    // And the reuse-detection response revokes the whole family: even the
    // token that replaced it (`rotated.refreshToken`) is now dead.
    await expect(authService.refresh(rotated.refreshToken)).rejects.toThrow(
      TokenRevokedError,
    );
  });

  it('logout revokes the refresh token so it can no longer be used', async () => {
    await authService.register({
      email: 'erin@example.com',
      password: 'correct-horse-battery-staple',
    });
    const session = await authService.login({
      email: 'erin@example.com',
      password: 'correct-horse-battery-staple',
    });

    await authService.logout(
      'some-jti',
      new Date(Date.now() + 60_000),
      session.refreshToken,
    );

    await expect(authService.refresh(session.refreshToken)).rejects.toThrow(
      TokenRevokedError,
    );
  });
});
