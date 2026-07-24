import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { RateLimitAlgorithm } from '../ratelimit.types';

/**
 * `name` is either a plain limiter name (`"login"`) or a role-scoped
 * override (`"login:role:admin"`) — the same naming convention
 * `StaticRateLimiterRuleResolver` already uses for its in-memory
 * `limiters` map, so a DB row and a static config entry are
 * interchangeable from every caller's perspective.
 */
@Entity('ratelimit_rules')
export class RateLimitRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  name!: string;

  @Column({ type: 'int' })
  limit!: number;

  @Column({ type: 'int' })
  windowMs!: number;

  @Column({ type: 'varchar', nullable: true })
  algorithm?: RateLimitAlgorithm | null;

  @Column({ type: 'datetime' })
  updatedAt!: Date;
}
