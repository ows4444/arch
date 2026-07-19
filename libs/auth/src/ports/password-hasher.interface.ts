export interface PasswordHasher {
  readonly algo: string;

  hash(plaintext: string): Promise<string>;

  verify(hash: string, plaintext: string): Promise<boolean>;
}
