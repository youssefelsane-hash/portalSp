import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { GeoJsonPoint, GeoJsonPolygon } from '../../../common/types/geo-json';

@Entity('areas')
export class Area {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'city_id', type: 'uuid' })
  cityId: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 120 })
  nameAr: string;

  @Column({ name: 'name_en', type: 'varchar', length: 120 })
  nameEn: string;

  @Column({ type: 'varchar', length: 120 })
  slug: string;

  @Column({
    type: 'geography',
    spatialFeatureType: 'Polygon',
    srid: 4326,
    nullable: true,
  })
  boundary: GeoJsonPolygon | null;

  @Column({
    name: 'center_location',
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  centerLocation: GeoJsonPoint | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'is_launched', type: 'boolean', default: false })
  isLaunched: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
