import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق لـ infra/migrations/0065_buildings.sql — نظام العمائر (docs/08 §13، ADR-0003)
@Entity('buildings')
export class Building {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  code: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 200 })
  nameAr: string;

  @Column({ name: 'address_text', type: 'text', nullable: true })
  addressText: string | null;

  @Column({ name: 'city_id', type: 'uuid', nullable: true })
  cityId: string | null;

  @Column({ name: 'discount_percentage', type: 'numeric', precision: 5, scale: 2, default: 10 })
  discountPercentage: string;

  @Column({ name: 'minimum_monthly_orders', type: 'smallint', default: 5 })
  minimumMonthlyOrders: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
