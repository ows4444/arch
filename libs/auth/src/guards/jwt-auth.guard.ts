import {
  CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TokenService } from '../application/token.service';
import { ACCESS_TOKEN_DENYLIST } from '../auth.constants';
import type { AccessTokenDenylist } from '../ports/access-token-denylist.interface';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

export interface AuthenticatedUser {
  userId: string;

  email: string;

  roles: string[];

  permissions: string[];

  jti: string;

  tokenExpiresAt: Date;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    @Inject(ACCESS_TOKEN_DENYLIST)
    private readonly denylist: AccessTokenDenylist,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();

    const token = this.extractToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('Missing bearer token.');
    }

    const payload = this.verify(token);

    if (await this.denylist.isDenied(payload.jti)) {
      throw new UnauthorizedException('This token has been revoked.');
    }

    request.user = {
      userId: payload.sub,
      email: payload.email,
      roles: payload.roles,
      permissions: payload.permissions,
      jti: payload.jti,
      tokenExpiresAt: payload.exp ? new Date(payload.exp * 1000) : new Date(),
    };

    return true;
  }

  private verify(token: string) {
    try {
      return this.tokens.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }
  }

  private extractToken(header: string | undefined): string | undefined {
    if (!header?.startsWith('Bearer ')) {
      return undefined;
    }

    return header.slice('Bearer '.length);
  }
}
