import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum BrandingAssetType {
  PRIMARY_LOGO = 'primary_logo',
  // اختصار اللوجو / رمز التفضيل (ملاحظة المالك: حرف الـ"جاكوش" — زي حرف T بتاع طلبات، U بتاع أوبر).
  LOGO_MARK = 'logo_mark',
  LOGO_LIGHT = 'logo_light',
  LOGO_DARK = 'logo_dark',
  LOGIN_LOGO = 'login_logo',
  SPLASH = 'splash',
}

/**
 * "مؤشر حالي" بس لكل asset_type (unique constraint) — مش تاريخ نسخ (ADR-0014، قرار Phase 1 مبسّط
 * عمداً). كل رفع بيتخزّن تحت storage_key جديد كليًا، فاستبدال الملف مبيكسرش عملاء متكاشين على
 * الرابط القديم فورًا (الملف القديم لسه موجود في التخزين لحد تنضيف لاحق يدوي).
 */
@Entity('branding_assets')
export class BrandingAsset {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'asset_type', type: 'enum', enum: BrandingAssetType, enumName: 'branding_asset_type', unique: true })
  assetType: BrandingAssetType;

  // مفتاح التخزين بس، مش رابط — الرابط بيتولّد طازة وقت كل قراءة (storage.getUrl()، ADR-0014).
  @Column({ name: 'storage_key', type: 'varchar', length: 300 })
  storageKey: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 60 })
  mimeType: string;

  @Column({ name: 'width_px', type: 'smallint' })
  widthPx: number;

  @Column({ name: 'height_px', type: 'smallint' })
  heightPx: number;

  @Column({ name: 'file_size_bytes', type: 'integer' })
  fileSizeBytes: number;

  @Column({ name: 'original_file_name', type: 'varchar', length: 255, nullable: true })
  originalFileName: string | null;

  @Column({ name: 'uploaded_by_user_id', type: 'uuid' })
  uploadedByUserId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
