import {
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserStatus } from './user-status.enum';
import { RoleEntity } from './role.entity';

@Entity('auth_users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  email!: string;

  @Column({ type: 'varchar' })
  passwordHash!: string;

  @Column({ type: 'varchar' })
  passwordAlgo!: string;

  @Column({ type: 'varchar', default: UserStatus.ACTIVE })
  status!: UserStatus;

  @Column({ type: 'datetime', nullable: true })
  emailVerifiedAt?: Date | null;

  @ManyToMany(() => RoleEntity)
  @JoinTable({
    name: 'auth_user_roles',
    joinColumn: { name: 'userId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'roleId', referencedColumnName: 'id' },
  })
  roles!: RoleEntity[];

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
