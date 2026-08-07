import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { DevicePlatform } from '../../auth/entities/refresh-token.entity';

@Entity('user_devices')
export class UserDevice {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'device_id', type: 'varchar', length: 128, unique: true })
  deviceId: string;

  @Column({ name: 'fcm_token', type: 'text', nullable: true })
  fcmToken: string | null;

  @Column({ type: 'enum', enum: DevicePlatform, enumName: 'device_platform' })
  platform: DevicePlatform;

  @Column({ name: 'os_version', type: 'varchar', length: 40, nullable: true })
  osVersion: string | null;

  @Column({ name: 'app_version', type: 'varchar', length: 20, nullable: true })
  appVersion: string | null;

  @Column({ name: 'device_model', type: 'varchar', length: 80, nullable: true })
  deviceModel: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'last_active_at', type: 'timestamptz' })
  lastActiveAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
