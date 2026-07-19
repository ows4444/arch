import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { PasswordHasher } from '../ports/password-hasher.interface';

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  readonly algo = 'argon2id';

  hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, { type: argon2.argon2id });
  }

  verify(hash: string, plaintext: string): Promise<boolean> {
    return argon2.verify(hash, plaintext);
  }
}
