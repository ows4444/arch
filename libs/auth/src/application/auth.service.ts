import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@/database';
import { UserRepository } from '../domain/user.repository';
import { UserEntity } from '../domain/user.entity';
import { UserStatus } from '../domain/user-status.enum';
import { TokenService } from './token.service';
import {
  RefreshTokenService,
  type ActiveSession,
  type RefreshTokenMetadata,
} from './refresh-token.service';
import { EmailVerificationService } from './email-verification.service';
import {
  ACCESS_TOKEN_DENYLIST,
  AUTH_EVENT_PUBLISHER,
  PASSWORD_HASHER,
} from '../auth.constants';
import type { PasswordHasher } from '../ports/password-hasher.interface';
import type { AuthEventPublisher } from '../ports/auth-event-publisher.interface';
import type { AccessTokenDenylist } from '../ports/access-token-denylist.interface';
import { InvalidCredentialsError } from '../errors/invalid-credentials.error';
import { AccountDisabledError } from '../errors/account-disabled.error';
import { EmailNotVerifiedError } from '../errors/email-not-verified.error';
import { EmailAlreadyRegisteredError } from '../errors/email-already-registered.error';
import { UserNotFoundError } from '../errors/user-not-found.error';
import type { RegisterDto } from '../dto/register.dto';
import type { LoginDto } from '../dto/login.dto';
import { UniqueEmailSpecification } from '../specifications/unique-email.specification';

export interface AuthSession {
  userId: string;

  accessToken: string;

  accessTokenExpiresAt: Date;

  refreshToken: string;

  refreshTokenExpiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserRepository)
    private readonly users: UserRepository,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly emailVerification: EmailVerificationService,
    @Inject(PASSWORD_HASHER)
    private readonly passwordHasher: PasswordHasher,
    @Inject(AUTH_EVENT_PUBLISHER)
    private readonly events: AuthEventPublisher,
    @Inject(ACCESS_TOKEN_DENYLIST)
    private readonly denylist: AccessTokenDenylist,
  ) {}

  async register(dto: RegisterDto): Promise<UserEntity> {
    const email = dto.email.toLowerCase();
    const uniqueEmail = new UniqueEmailSpecification(this.users);

    if (!(await uniqueEmail.isSatisfiedBy(email))) {
      throw new EmailAlreadyRegisteredError();
    }

    const passwordHash = await this.passwordHasher.hash(dto.password);

    const user = await this.users.save({
      email,
      passwordHash,
      passwordAlgo: this.passwordHasher.algo,
      status: UserStatus.UNVERIFIED,
    });

    await this.emailVerification.issue(user.id, user.email);

    await this.events.publishUserRegistered({
      userId: user.id,
      email: user.email,
    });

    return user;
  }

  async login(
    dto: LoginDto,
    metadata?: RefreshTokenMetadata,
  ): Promise<AuthSession> {
    const user = await this.users.findByEmail(dto.email.toLowerCase());

    if (!user) {
      throw new InvalidCredentialsError();
    }

    const valid = await this.passwordHasher.verify(
      user.passwordHash,
      dto.password,
    );

    if (!valid) {
      throw new InvalidCredentialsError();
    }

    if (user.status === UserStatus.UNVERIFIED) {
      throw new EmailNotVerifiedError();
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new AccountDisabledError();
    }

    const session = await this.issueSession(user, metadata);

    await this.events.publishUserLoggedIn({ userId: user.id, at: new Date() });

    return session;
  }

  async refresh(
    rawRefreshToken: string,
    metadata?: RefreshTokenMetadata,
  ): Promise<AuthSession> {
    const { userId, refreshToken } = await this.refreshTokens.rotate(
      rawRefreshToken,
      metadata,
    );

    const user = await this.users.findById(userId);

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new AccountDisabledError();
    }

    const accessToken = this.signAccessToken(user);

    return {
      userId: user.id,
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt,
      refreshToken: refreshToken.token,
      refreshTokenExpiresAt: refreshToken.expiresAt,
    };
  }

  async logout(
    accessTokenJti: string,
    accessTokenExpiresAt: Date,
    rawRefreshToken: string,
  ): Promise<void> {
    await Promise.all([
      this.refreshTokens.revoke(rawRefreshToken),
      this.denylist.deny(accessTokenJti, accessTokenExpiresAt),
    ]);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId);
  }

  listSessions(userId: string): Promise<ActiveSession[]> {
    return this.refreshTokens.listActiveForUser(userId);
  }

  revokeSession(userId: string, sessionId: string): Promise<void> {
    return this.refreshTokens.revokeOne(userId, sessionId);
  }

  /**
   * For an already-authenticated user who knows their current password —
   * distinct from `PasswordResetService.confirmReset`'s anonymous,
   * token-based flow. Revokes every refresh token on success, same
   * reasoning `logoutAll`/`PasswordResetService.confirmReset` already
   * apply: changing the password is exactly the moment every other
   * session should be forced to re-authenticate.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.users.findById(userId);

    if (!user) {
      throw new UserNotFoundError(userId);
    }

    const valid = await this.passwordHasher.verify(
      user.passwordHash,
      currentPassword,
    );

    if (!valid) {
      throw new InvalidCredentialsError();
    }

    const passwordHash = await this.passwordHasher.hash(newPassword);

    await this.users.save({
      id: user.id,
      passwordHash,
      passwordAlgo: this.passwordHasher.algo,
    });

    await this.refreshTokens.revokeAllForUser(user.id);
    await this.events.publishPasswordChanged({ userId: user.id });
  }

  private async issueSession(
    user: UserEntity,
    metadata?: RefreshTokenMetadata,
  ): Promise<AuthSession> {
    const accessToken = this.signAccessToken(user);
    const refreshToken = await this.refreshTokens.issue(user.id, metadata);

    return {
      userId: user.id,
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt,
      refreshToken: refreshToken.token,
      refreshTokenExpiresAt: refreshToken.expiresAt,
    };
  }

  private signAccessToken(user: UserEntity) {
    return this.tokens.sign({
      sub: user.id,
      email: user.email,
      roles: user.roles?.map((role) => role.name) ?? [],
      permissions: this.flattenPermissions(user),
    });
  }

  private flattenPermissions(user: UserEntity): string[] {
    const names = new Set<string>();

    for (const role of user.roles ?? []) {
      for (const permission of role.permissions ?? []) {
        names.add(permission.name);
      }
    }

    return [...names];
  }
}
