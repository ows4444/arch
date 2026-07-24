import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One row per user. `enabled: false` means enrollment was started
 * (`MfaService.beginEnrollment`) but never confirmed — the pending
 * `secretCiphertext` is overwritten (not appended to) on a re-attempt,
 * see `MfaSecretRepository.upsertPending`. `secretCiphertext` is the raw
 * TOTP secret encrypted via `MfaSecretCipher`, never stored in plaintext.
 */
@Entity('auth_mfa_secrets')
export class MfaSecretEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  userId!: string;

  @Column({ type: 'varchar' })
  secretCiphertext!: string;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
