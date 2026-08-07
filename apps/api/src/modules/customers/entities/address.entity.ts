import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { GeoJsonPoint } from '../../../common/types/geo-json';

@Entity('addresses')
export class Address {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  label: string | null;

  @Column({ name: 'city_id', type: 'uuid', nullable: true })
  cityId: string | null;

  @Column({ name: 'area_id', type: 'uuid', nullable: true })
  areaId: string | null;

  @Column({ name: 'street_name', type: 'varchar', length: 160 })
  streetName: string;

  @Column({ name: 'building_number', type: 'varchar', length: 20, nullable: true })
  buildingNumber: string | null;

  @Column({ name: 'floor_number', type: 'varchar', length: 10, nullable: true })
  floorNumber: string | null;

  @Column({ name: 'apartment_number', type: 'varchar', length: 10, nullable: true })
  apartmentNumber: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  landmark: string | null;

  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
  })
  location: GeoJsonPoint;

  @Column({ name: 'contact_name', type: 'varchar', length: 120, nullable: true })
  contactName: string | null;

  @Column({ name: 'contact_phone', type: 'varchar', length: 15, nullable: true })
  contactPhone: string | null;

  @Column({ name: 'delivery_notes', type: 'text', nullable: true })
  deliveryNotes: string | null;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @Column({ name: 'is_verified', type: 'boolean', default: false })
  isVerified: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
