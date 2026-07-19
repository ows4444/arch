import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('auth_permissions')
export class PermissionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  description?: string | null;
}
