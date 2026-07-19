import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import {
  AUTH_MODULE_OPTIONS,
  DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
} from '../auth.constants';
import type { AuthModuleOptions } from '../auth.types';

export interface AccessTokenClaims {
  sub: string;

  email: string;

  roles: string[];

  permissions: string[];
}

export interface AccessTokenPayload extends AccessTokenClaims {
  jti: string;

  /** Populated by `jsonwebtoken` on verify — seconds-since-epoch expiry. */
  exp?: number;
}

export interface SignedAccessToken {
  token: string;

  jti: string;

  expiresAt: Date;
}

@Injectable()
export class TokenService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly jwtService: JwtService,
    @Inject(AUTH_MODULE_OPTIONS) options: AuthModuleOptions,
  ) {
    this.ttlSeconds =
      options.jwt.accessTokenTtlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  }

  sign(claims: AccessTokenClaims): SignedAccessToken {
    const jti = randomUUID();
    const payload: AccessTokenPayload = { ...claims, jti };

    const token = this.jwtService.sign(payload, {
      expiresIn: this.ttlSeconds,
    });

    return {
      token,
      jti,
      expiresAt: new Date(Date.now() + this.ttlSeconds * 1000),
    };
  }

  verify(token: string): AccessTokenPayload {
    return this.jwtService.verify<AccessTokenPayload>(token);
  }
}
