import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { GeoJsonPoint } from '../../../common/types/geo-json';

@Entity('cities')
export class City {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'country_id', type: 'uuid' })
  countryId: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 120 })
  nameAr: string;

  @Column({ name: 'name_en', type: 'varchar', length: 120 })
  nameEn: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  slug: string;

  @Column({
    name: 'center_location',
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  centerLocation: GeoJsonPoint | null;

  @Column({ type: 'varchar', length: 40, default: 'Africa/Cairo' })
  timezone: string;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean;

  @Column({ name: 'launched_at', type: 'timestamptz', nullable: true })
  launchedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
