import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { DatabaseRole, RepositoryResolver } from '@/database';

type DataSourceManager = ConstructorParameters<typeof RepositoryResolver>[0];
import { UserRepository } from './domain/user.repository';
import { RoleRepository } from './domain/role.repository';
import { PermissionRepository } from './domain/permission.repository';
import { AuthorizationService } from './application/authorization.service';
import { AuthService } from './application/auth.service';
import { TokenService } from './application/token.service';
import { RefreshTokenService } from './application/refresh-token.service';
import { EmailVerificationService } from './application/email-verification.service';
import { RefreshTokenRepository } from './domain/refresh-token.repository';
import { AuthTokenRepository } from './domain/auth-token.repository';
import { Argon2PasswordHasher } from './adapters/argon2-password-hasher';
import { NoopAccessTokenDenylist } from './adapters/noop-access-token-denylist';
import { AUTH_TYPEORM_ENTITIES } from './persistence/entities';
import type { AuthModuleOptions } from './auth.types';
import type { AuthEventPublisher } from './ports/auth-event-publisher.interface';

/**
 * Same regression as `auth.integration.spec.ts`'s "concurrent assignRole"
 * test, but against real MySQL (a scratch schema in the local `make
 * compose-up` MySQL instance) instead of in-memory sqlite. sqlite's
 * `better-sqlite3` driver serializes every query onto one connection, so
 * two "concurrent" `Promise.all` calls never actually race at the storage
 * engine — they just interleave on a single thread. MySQL's connection pool
 * gives each call its own connection, which is the only way to genuinely
 * exercise the duplicate-key race `UserRepository.addRole` is built to
 * survive (libs/auth/LOOP.md Loop 018).
 *
 * Requires `make compose-up` and a scratch database the `app` user can
 * create tables in (`CREATE DATABASE app_scratch` + `GRANT ALL ... TO
 * 'app'@'%'`, done once for local dev). Skipped by default so `npm test`
 * stays hermetic; run explicitly with:
 *   RUN_MYSQL_INTEGRATION_TESTS=1 npx jest auth-concurrency.mysql
 */
const describeIfMysql =
  process.env.RUN_MYSQL_INTEGRATION_TESTS === '1' ? describe : describe.skip;

describeIfMysql('libs/auth concurrency integration (real MySQL)', () => {
  let dataSource: DataSource;
  let userRepo: UserRepository;
  let roleRepo: RoleRepository;
  let permissionRepo: PermissionRepository;
  let authorizationService: AuthorizationService;
  let authService: AuthService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'mysql',
      host: process.env.MYSQL_HOST ?? 'localhost',
      port: Number(process.env.MYSQL_PORT ?? 3307),
      username: process.env.MYSQL_USERNAME ?? 'app',
      password: process.env.MYSQL_PASSWORD ?? 'app',
      database: 'app_scratch',
      entities: [...AUTH_TYPEORM_ENTITIES],
      synchronize: true,
      dropSchema: true,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(() => {
    const dataSourceManager = {
      manager: () => dataSource.manager,
      dataSource: () => dataSource,
      repository: (entity: never) => dataSource.manager.getRepository(entity),
    } as unknown as DataSourceManager;

    const resolver = new RepositoryResolver(dataSourceManager);

    userRepo = new UserRepository(DatabaseRole.WRITE, resolver);
    roleRepo = new RoleRepository(DatabaseRole.WRITE, resolver);
    permissionRepo = new PermissionRepository(DatabaseRole.WRITE, resolver);
    const refreshTokenRepo = new RefreshTokenRepository(
      DatabaseRole.WRITE,
      resolver,
    );
    const authTokenRepo = new AuthTokenRepository(DatabaseRole.WRITE, resolver);

    const options: AuthModuleOptions = {
      jwt: { secret: 'mysql-integration-test-secret-1234567890' },
    };
    const tokenService = new TokenService(
      new JwtService({ secret: options.jwt.secret }),
      options,
    );
    const events: AuthEventPublisher = {
      publishUserRegistered: () => Promise.resolve(),
      publishUserLoggedIn: () => Promise.resolve(),
      publishPasswordChanged: () => Promise.resolve(),
      publishRefreshTokenReuseDetected: () => Promise.resolve(),
      publishEmailVerificationRequested: () => Promise.resolve(),
      publishPasswordResetRequested: () => Promise.resolve(),
    };
    const refreshTokenService = new RefreshTokenService(
      refreshTokenRepo,
      options,
      events,
    );
    const emailVerificationService = new EmailVerificationService(
      authTokenRepo,
      userRepo,
      options,
      events,
    );
    authService = new AuthService(
      userRepo,
      tokenService,
      refreshTokenService,
      emailVerificationService,
      new Argon2PasswordHasher(),
      events,
      new NoopAccessTokenDenylist(),
    );
    authorizationService = new AuthorizationService(
      userRepo,
      roleRepo,
      permissionRepo,
      { record: () => Promise.resolve() } as never,
    );
  });

  it('concurrent assignRole calls for different roles on the same user do not lose a grant, under a real connection pool', async () => {
    await authorizationService.createRole('editor');
    await authorizationService.createRole('viewer');

    // Run many repetitions in one test: a single pair of concurrent calls
    // can pass by luck even against a genuinely racy implementation if the
    // driver happens to serialize them. Repetition raises confidence this
    // is a real fix, not a lucky ordering.
    for (let i = 0; i < 20; i++) {
      const email = `pete-mysql-${i}@example.com`;
      await authService.register({
        email,
        password: 'correct-horse-battery-staple',
      });
      const u = await userRepo.findByEmail(email);

      await Promise.all([
        authorizationService.assignRole(u!.id, 'editor'),
        authorizationService.assignRole(u!.id, 'viewer'),
      ]);

      const reloaded = await userRepo.findByEmail(email);
      expect(reloaded?.roles.map((role) => role.name).sort()).toEqual([
        'editor',
        'viewer',
      ]);
    }
  });
});
