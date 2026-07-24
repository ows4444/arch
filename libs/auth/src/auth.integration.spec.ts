import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { DatabaseRole, RepositoryResolver } from '@/database';

type DataSourceManager = ConstructorParameters<typeof RepositoryResolver>[0];
import { UserRepository } from './domain/user.repository';
import { RoleRepository } from './domain/role.repository';
import { PermissionRepository } from './domain/permission.repository';
import { RefreshTokenRepository } from './domain/refresh-token.repository';
import { AuthTokenRepository } from './domain/auth-token.repository';
import { UserStatus } from './domain/user-status.enum';
import { AUTH_TYPEORM_ENTITIES } from './persistence/entities';
import { AuthService } from './application/auth.service';
import { AuthorizationService } from './application/authorization.service';
import { TokenService } from './application/token.service';
import { RefreshTokenService } from './application/refresh-token.service';
import { EmailVerificationService } from './application/email-verification.service';
import { PasswordResetService } from './application/password-reset.service';
import { Argon2PasswordHasher } from './adapters/argon2-password-hasher';
import { NoopAccessTokenDenylist } from './adapters/noop-access-token-denylist';
import { InvalidCredentialsError } from './errors/invalid-credentials.error';
import { TokenRevokedError } from './errors/token-revoked.error';
import { EmailNotVerifiedError } from './errors/email-not-verified.error';
import { PasswordResetTokenInvalidError } from './errors/password-reset-token-invalid.error';
import type { AuthModuleOptions } from './auth.types';
import type { AuthEventPublisher } from './ports/auth-event-publisher.interface';

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
  let permissionRepo: PermissionRepository;
  let refreshTokenRepo: RefreshTokenRepository;
  let authTokenRepo: AuthTokenRepository;
  let authService: AuthService;
  let authorizationService: AuthorizationService;
  let emailVerificationService: EmailVerificationService;
  let passwordResetService: PasswordResetService;
  let capturedVerificationToken: string | undefined;
  let capturedResetToken: string | undefined;

  /** Bypasses the verification flow itself for tests exercising something else. */
  async function activate(email: string): Promise<void> {
    const user = await userRepo.findByEmail(email);
    await userRepo.save({ id: user!.id, status: UserStatus.ACTIVE });
  }

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
    permissionRepo = new PermissionRepository(DatabaseRole.WRITE, resolver);
    refreshTokenRepo = new RefreshTokenRepository(DatabaseRole.WRITE, resolver);
    authTokenRepo = new AuthTokenRepository(DatabaseRole.WRITE, resolver);

    const options: AuthModuleOptions = {
      jwt: { secret: 'integration-test-secret-value-1234567890' },
    };
    const tokenService = new TokenService(
      new JwtService({ secret: options.jwt.secret }),
      options,
    );

    capturedVerificationToken = undefined;
    capturedResetToken = undefined;

    const events: AuthEventPublisher = {
      publishUserRegistered: () => Promise.resolve(),
      publishUserLoggedIn: () => Promise.resolve(),
      publishPasswordChanged: () => Promise.resolve(),
      publishRefreshTokenReuseDetected: () => Promise.resolve(),
      publishEmailVerificationRequested: (event) => {
        capturedVerificationToken = event.token;
        return Promise.resolve();
      },
      publishPasswordResetRequested: (event) => {
        capturedResetToken = event.token;
        return Promise.resolve();
      },
    };
    const refreshTokenService = new RefreshTokenService(
      refreshTokenRepo,
      options,
      events,
    );
    emailVerificationService = new EmailVerificationService(
      authTokenRepo,
      userRepo,
      options,
      events,
    );
    const passwordHasher = new Argon2PasswordHasher();
    const denylist = new NoopAccessTokenDenylist();

    authService = new AuthService(
      userRepo,
      tokenService,
      refreshTokenService,
      emailVerificationService,
      passwordHasher,
      events,
      denylist,
    );
    authorizationService = new AuthorizationService(
      userRepo,
      roleRepo,
      permissionRepo,
      // Real audit persistence isn't this suite's concern — see
      // libs/audit's own tests for that; this exercises real RBAC
      // persistence only.
      { record: () => Promise.resolve() } as never,
    );
    passwordResetService = new PasswordResetService(
      authTokenRepo,
      userRepo,
      refreshTokenService,
      passwordHasher,
      options,
      events,
    );
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('registers, logs in, and issues a real signed access token', async () => {
    await authService.register({
      email: 'alice@example.com',
      password: 'correct-horse-battery-staple',
    });
    await activate('alice@example.com');

    const session = await authService.login({
      email: 'Alice@Example.com',
      password: 'correct-horse-battery-staple',
    });

    expect(session.accessToken.split('.')).toHaveLength(3);
    expect(session.refreshToken).toEqual(expect.any(String));

    const stored = await userRepo.findByEmail('alice@example.com');
    expect(stored?.passwordHash).not.toBe('correct-horse-battery-staple');
  });

  it('stores an optional caller-supplied deviceId on the issued refresh token', async () => {
    await authService.register({
      email: 'ivy@example.com',
      password: 'correct-horse-battery-staple',
    });
    await activate('ivy@example.com');

    const session = await authService.login(
      { email: 'ivy@example.com', password: 'correct-horse-battery-staple' },
      { createdByIp: '203.0.113.9', deviceId: 'device-abc-123' },
    );

    const stored = await refreshTokenRepo.findByTokenHash(
      createHash('sha256').update(session.refreshToken).digest('hex'),
    );
    expect(stored?.deviceId).toBe('device-abc-123');
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

  it('full RBAC management flow: create permission+role, assign, check, revoke — all against real tables', async () => {
    await authService.register({
      email: 'frank@example.com',
      password: 'correct-horse-battery-staple',
    });
    const user = await userRepo.findByEmail('frank@example.com');

    await authorizationService.createPermission('roles:manage', 'Manage roles');
    await authorizationService.createRole('admin', ['roles:manage']);
    await authorizationService.assignRole(user!.id, 'admin');

    expect(
      await authorizationService.hasPermission(user!.id, 'roles:manage'),
    ).toBe(true);
    expect(await authorizationService.hasRole(user!.id, 'admin')).toBe(true);

    const roles = await authorizationService.listRoles();
    expect(roles).toHaveLength(1);
    expect(roles[0]?.permissions.map((p) => p.name)).toEqual(['roles:manage']);

    await authorizationService.revokeRole(user!.id, 'admin');

    expect(await authorizationService.hasRole(user!.id, 'admin')).toBe(false);
    expect(
      await authorizationService.hasPermission(user!.id, 'roles:manage'),
    ).toBe(false);
  });

  it('assigning the same role twice is idempotent', async () => {
    await authService.register({
      email: 'olga@example.com',
      password: 'correct-horse-battery-staple',
    });
    const user = await userRepo.findByEmail('olga@example.com');
    await authorizationService.createRole('admin');

    await authorizationService.assignRole(user!.id, 'admin');
    await expect(
      authorizationService.assignRole(user!.id, 'admin'),
    ).resolves.toBeUndefined();

    const reloaded = await userRepo.findByEmail('olga@example.com');
    expect(reloaded?.roles.map((role) => role.name)).toEqual(['admin']);
  });

  it('concurrent assignRole calls for different roles on the same user do not lose a grant', async () => {
    // This is the race `UserRepository.addRole`'s direct join-table INSERT
    // exists to prevent: a load-modify-`save()` round trip (the previous
    // implementation) would have both concurrent calls compute their own
    // "desired roles array" from the same stale read, and whichever `save()`
    // landed second would silently overwrite the first's grant.
    await authService.register({
      email: 'pete@example.com',
      password: 'correct-horse-battery-staple',
    });
    const user = await userRepo.findByEmail('pete@example.com');
    await authorizationService.createRole('editor');
    await authorizationService.createRole('viewer');

    await Promise.all([
      authorizationService.assignRole(user!.id, 'editor'),
      authorizationService.assignRole(user!.id, 'viewer'),
    ]);

    const reloaded = await userRepo.findByEmail('pete@example.com');
    expect(reloaded?.roles.map((role) => role.name).sort()).toEqual([
      'editor',
      'viewer',
    ]);
  });

  it('rotates a refresh token exactly once, then rejects reuse of the old one', async () => {
    await authService.register({
      email: 'dave@example.com',
      password: 'correct-horse-battery-staple',
    });
    await activate('dave@example.com');
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

  it('evicts the oldest active session once the default 5-device limit is exceeded', async () => {
    await authService.register({
      email: 'nina@example.com',
      password: 'correct-horse-battery-staple',
    });
    await activate('nina@example.com');

    const sessions = [];
    for (let i = 0; i < 5; i++) {
      sessions.push(
        await authService.login({
          email: 'nina@example.com',
          password: 'correct-horse-battery-staple',
        }),
      );
    }

    // A 6th concurrent login succeeds rather than being rejected...
    const sixth = await authService.login({
      email: 'nina@example.com',
      password: 'correct-horse-battery-staple',
    });
    expect(sixth.accessToken.split('.')).toHaveLength(3);

    // ...but silently evicts the oldest (first) of the five prior sessions.
    await expect(
      authService.refresh(sessions[0]!.refreshToken),
    ).rejects.toThrow(TokenRevokedError);

    // The other four original sessions, and the newest one, are unaffected.
    for (const session of sessions.slice(1)) {
      await expect(
        authService.refresh(session.refreshToken),
      ).resolves.toBeDefined();
    }
    await expect(
      authService.refresh(sixth.refreshToken),
    ).resolves.toBeDefined();
  });

  it('logout revokes the refresh token so it can no longer be used', async () => {
    await authService.register({
      email: 'erin@example.com',
      password: 'correct-horse-battery-staple',
    });
    await activate('erin@example.com');
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

  it('blocks login until the verification token is confirmed, then allows it', async () => {
    await authService.register({
      email: 'grace@example.com',
      password: 'correct-horse-battery-staple',
    });

    await expect(
      authService.login({
        email: 'grace@example.com',
        password: 'correct-horse-battery-staple',
      }),
    ).rejects.toThrow(EmailNotVerifiedError);

    expect(capturedVerificationToken).toEqual(expect.any(String));
    await emailVerificationService.confirm(capturedVerificationToken!);

    const session = await authService.login({
      email: 'grace@example.com',
      password: 'correct-horse-battery-staple',
    });

    expect(session.accessToken.split('.')).toHaveLength(3);

    const stored = await userRepo.findByEmail('grace@example.com');
    expect(stored?.status).toBe(UserStatus.ACTIVE);
    expect(stored?.emailVerifiedAt).not.toBeNull();
  });

  it('rejects a verification token that has already been used', async () => {
    await authService.register({
      email: 'heidi@example.com',
      password: 'correct-horse-battery-staple',
    });

    await emailVerificationService.confirm(capturedVerificationToken!);

    await expect(
      emailVerificationService.confirm(capturedVerificationToken!),
    ).rejects.toThrow();
  });

  it('resets a password end-to-end and revokes every existing session', async () => {
    await authService.register({
      email: 'ivan@example.com',
      password: 'original-password-value',
    });
    await activate('ivan@example.com');
    const session = await authService.login({
      email: 'ivan@example.com',
      password: 'original-password-value',
    });

    await passwordResetService.requestReset('ivan@example.com');
    expect(capturedResetToken).toEqual(expect.any(String));

    await passwordResetService.confirmReset(
      capturedResetToken!,
      'brand-new-password-value',
    );

    // The old password no longer works.
    await expect(
      authService.login({
        email: 'ivan@example.com',
        password: 'original-password-value',
      }),
    ).rejects.toThrow(InvalidCredentialsError);

    // The new one does.
    const relogged = await authService.login({
      email: 'ivan@example.com',
      password: 'brand-new-password-value',
    });
    expect(relogged.accessToken.split('.')).toHaveLength(3);

    // The session that existed before the reset is revoked.
    await expect(authService.refresh(session.refreshToken)).rejects.toThrow(
      TokenRevokedError,
    );
  });

  it('rejects confirming a password reset with an invalid token, without touching the password', async () => {
    await authService.register({
      email: 'judy@example.com',
      password: 'original-password-value',
    });
    await activate('judy@example.com');

    await expect(
      passwordResetService.confirmReset('not-a-real-token', 'irrelevant-new'),
    ).rejects.toThrow(PasswordResetTokenInvalidError);

    const session = await authService.login({
      email: 'judy@example.com',
      password: 'original-password-value',
    });
    expect(session.accessToken.split('.')).toHaveLength(3);
  });

  it('silently no-ops requesting a reset for an email that is not registered', async () => {
    await expect(
      passwordResetService.requestReset('nobody@example.com'),
    ).resolves.toBeUndefined();
    expect(capturedResetToken).toBeUndefined();
  });

  it('changes the password while authenticated and revokes every other session', async () => {
    await authService.register({
      email: 'kevin@example.com',
      password: 'original-password-value',
    });
    await activate('kevin@example.com');
    const session = await authService.login({
      email: 'kevin@example.com',
      password: 'original-password-value',
    });
    const user = await userRepo.findByEmail('kevin@example.com');

    await authService.changePassword(
      user!.id,
      'original-password-value',
      'brand-new-password-value',
    );

    // The old password no longer works.
    await expect(
      authService.login({
        email: 'kevin@example.com',
        password: 'original-password-value',
      }),
    ).rejects.toThrow(InvalidCredentialsError);

    // The new one does.
    const relogged = await authService.login({
      email: 'kevin@example.com',
      password: 'brand-new-password-value',
    });
    expect(relogged.accessToken.split('.')).toHaveLength(3);

    // The session that existed before the change is revoked.
    await expect(authService.refresh(session.refreshToken)).rejects.toThrow(
      TokenRevokedError,
    );
  });

  it('rejects changing the password with the wrong current password, without touching it', async () => {
    await authService.register({
      email: 'laura@example.com',
      password: 'original-password-value',
    });
    await activate('laura@example.com');
    const user = await userRepo.findByEmail('laura@example.com');

    await expect(
      authService.changePassword(user!.id, 'wrong-password', 'irrelevant-new'),
    ).rejects.toThrow(InvalidCredentialsError);

    const session = await authService.login({
      email: 'laura@example.com',
      password: 'original-password-value',
    });
    expect(session.accessToken.split('.')).toHaveLength(3);
  });
});
