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

  // ربط صور "بعد التنفيذ" مباشرة بصف التقييم (docs/08 §9) — null لحد ما العميل يربطها وقت
  // التقييم (ratings.service.ts). قبل كده order_media كان مستقل تمامًا عن ratings.
  @Column({ name: 'rating_id', type: 'uuid', nullable: true })
  ratingId: string | null;

  @Column({ name: 'uploaded_by_user_id', type: 'uuid' })
  uploadedByUserId: string;

  @Column({ name: 'media_type', type: 'enum', enum: OrderMediaType, enumName: 'order_media_type' })
  mediaType: OrderMediaType;

  @Column({ name: 'file_url', type: 'text' })
  fileUrl: string;

  // مفتاح التخزين (docs/08 §19 بند 9) — لو موجود، نمط getUrl(key) بيتستخدم وقت القراءة (رابط
  // طازة كل مرة بدل file_url الثابت اللي بينتهي بعد 7 أيام مع S3). NULL لأي صف قديم قبل الإصلاح.
  @Column({ name: 'storage_key', type: 'text', nullable: true })
  storageKey: string | null;

  @Column({ name: 'file_size_bytes', type: 'integer', nullable: true })
  fileSizeBytes: number | null;

  @Column({ name: 'pricing_field_upload_id', type: 'uuid', nullable: true })
  pricingFieldUploadId: string | null;

  @Column({ name: 'problem_image_upload_id', type: 'uuid', nullable: true })
  problemImageUploadId: string | null;

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
