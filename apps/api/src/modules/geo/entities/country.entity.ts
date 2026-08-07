import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('countries')
export class Country {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 120 })
  nameAr: string;

  @Column({ name: 'name_en', type: 'varchar', length: 120 })
  nameEn: string;

  @Column({ name: 'iso_code', type: 'varchar', length: 2, unique: true })
  isoCode: string;

  @Column({ name: 'phone_prefix', type: 'varchar', length: 6 })
  phonePrefix: string;

  @Column({ name: 'currency_code', type: 'varchar', length: 3 })
  currencyCode: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
