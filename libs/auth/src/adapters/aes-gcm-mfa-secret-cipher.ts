import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import type { MfaSecretCipher } from '../ports/mfa-secret-cipher.interface';
import { MfaConfigurationError } from '../errors/mfa-configuration.error';

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Default `MfaSecretCipher` — AES-256-GCM, keyed by SHA-256 of the
 * configured passphrase (`AuthModuleOptions.mfa.encryptionKey`, whatever
 * length ≥32 the schema enforces) to always land on exactly a 32-byte key
 * without asking the operator to manage raw key bytes themselves.
 *
 * Fails lazily, not at construction: `AuthModule` always instantiates
 * `MfaService` (it's a core provider like every other application
 * service), but most deployments won't configure MFA at all — throwing
 * here only when `encrypt`/`decrypt` is actually invoked (i.e. a real
 * enrollment/verification attempt) avoids forcing every existing
 * deployment to set `AUTH_MFA_ENCRYPTION_KEY` before it can boot.
 */
@Injectable()
export class AesGcmMfaSecretCipher implements MfaSecretCipher {
  private readonly key: Buffer | undefined;

  constructor(encryptionKey?: string) {
    this.key = encryptionKey
      ? createHash('sha256').update(encryptionKey).digest()
      : undefined;
  }

  encrypt(plaintext: string): string {
    const key = this.requireKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  decrypt(ciphertext: string): string {
    const key = this.requireKey();
    const raw = Buffer.from(ciphertext, 'base64');
    const iv = raw.subarray(0, IV_LENGTH);
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new MfaConfigurationError(
        'AUTH_MFA_ENCRYPTION_KEY (AuthModuleOptions.mfa.encryptionKey) must be configured before using MFA.',
      );
    }

    return this.key;
  }
}
