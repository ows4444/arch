import { Argon2PasswordHasher } from './argon2-password-hasher';

describe('Argon2PasswordHasher', () => {
  it('hashes a password and verifies the same plaintext against it', async () => {
    const hasher = new Argon2PasswordHasher();

    const hash = await hasher.hash('correct-horse-battery-staple');

    expect(hash).not.toBe('correct-horse-battery-staple');
    await expect(
      hasher.verify(hash, 'correct-horse-battery-staple'),
    ).resolves.toBe(true);
  });

  it('rejects the wrong plaintext', async () => {
    const hasher = new Argon2PasswordHasher();

    const hash = await hasher.hash('correct-horse-battery-staple');

    await expect(hasher.verify(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('reports its algorithm as argon2id', () => {
    const hasher = new Argon2PasswordHasher();

    expect(hasher.algo).toBe('argon2id');
  });
});
