import { AesGcmMfaSecretCipher } from './aes-gcm-mfa-secret-cipher';
import { MfaConfigurationError } from '../errors/mfa-configuration.error';

describe('AesGcmMfaSecretCipher', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const cipher = new AesGcmMfaSecretCipher('a-development-only-secret-key!!');
    const ciphertext = cipher.encrypt('JBSWY3DPEHPK3PXP');

    expect(ciphertext).not.toContain('JBSWY3DPEHPK3PXP');
    expect(cipher.decrypt(ciphertext)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('produces different ciphertext for the same plaintext each call (random IV)', () => {
    const cipher = new AesGcmMfaSecretCipher('a-development-only-secret-key!!');

    expect(cipher.encrypt('same-secret')).not.toBe(
      cipher.encrypt('same-secret'),
    );
  });

  it('fails to decrypt with a different key (authenticity check)', () => {
    const a = new AesGcmMfaSecretCipher('a-development-only-secret-key!!');
    const b = new AesGcmMfaSecretCipher('a-different-development-key!!!!');
    const ciphertext = a.encrypt('secret');

    expect(() => b.decrypt(ciphertext)).toThrow();
  });

  it('throws MfaConfigurationError when no key was configured', () => {
    const cipher = new AesGcmMfaSecretCipher();

    expect(() => cipher.encrypt('secret')).toThrow(MfaConfigurationError);
    expect(() => cipher.decrypt('anything')).toThrow(MfaConfigurationError);
  });
});
