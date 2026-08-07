import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { GeoJsonPoint } from '../../../common/types/geo-json';

export enum OrderMediaType {
  BEFORE_PHOTO = 'before_photo',
  AFTER_PHOTO = 'after_photo',
  PROBLEM_PHOTO = 'problem_photo',
  RECEIPT = 'receipt',
  SIGNATURE = 'signature',
  VIDEO = 'video',
}

@Entity('order_media')
export class OrderMedia {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'uploaded_by_user_id', type: 'uuid' })
  uploadedByUserId: string;

  @Column({ name: 'media_type', type: 'enum', enum: OrderMediaType, enumName: 'order_media_type' })
  mediaType: OrderMediaType;

  @Column({ name: 'file_url', type: 'text' })
  fileUrl: string;

  @Column({ name: 'file_size_bytes', type: 'integer', nullable: true })
  fileSizeBytes: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  caption: string | null;

  @CreateDateColumn({ name: 'taken_at', type: 'timestamptz' })
  takenAt: Date;

  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  location: GeoJsonPoint | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
