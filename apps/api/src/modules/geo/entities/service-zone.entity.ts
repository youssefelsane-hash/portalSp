import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { GeoJsonPolygon } from '../../../common/types/geo-json';

@Entity('service_zones')
export class ServiceZone {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'city_id', type: 'uuid' })
  cityId: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 120 })
  nameAr: string;

  @Column({ name: 'name_en', type: 'varchar', length: 120 })
  nameEn: string;

  @Column({
    type: 'geography',
    spatialFeatureType: 'Polygon',
    srid: 4326,
    nullable: true,
  })
  boundary: GeoJsonPolygon | null;

  @Column({ name: 'surge_multiplier', type: 'numeric', precision: 4, scale: 2, default: 1.0 })
  surgeMultiplier: string;

  @Column({ name: 'min_order_amount_cents', type: 'integer', nullable: true })
  minOrderAmountCents: number | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
