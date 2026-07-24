/**
 * Encrypts/decrypts TOTP secrets at rest. Distinct from `PasswordHasher`
 * (one-way) — verifying a TOTP code requires the raw secret back, so this
 * must be reversible.
 */
export interface MfaSecretCipher {
  encrypt(plaintext: string): string;

  decrypt(ciphertext: string): string;
}
