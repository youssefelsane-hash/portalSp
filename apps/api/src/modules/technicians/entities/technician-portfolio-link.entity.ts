import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum PortfolioLinkPlatform {
  TIKTOK = 'tiktok',
  YOUTUBE = 'youtube',
  INSTAGRAM = 'instagram',
  FACEBOOK = 'facebook',
}

@Entity('technician_portfolio_links')
export class TechnicianPortfolioLink {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ type: 'enum', enum: PortfolioLinkPlatform, enumName: 'portfolio_link_platform' })
  platform: PortfolioLinkPlatform;

  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  title: string | null;

  @Column({ name: 'thumbnail_url', type: 'text', nullable: true })
  thumbnailUrl: string | null;

  /** بَقّة حقيقية اتلقطت (docs/08 §81) — الـID الفعلي اللي oEmbed استخرجه (تيك توك بس حاليًا).
   * الكلاينت بيفضّله على تفكيك اللينك الخام بـregex محلي (بيفشل مع short links). null = لينك
   * قديم قبل الإصلاح، أو oEmbed فشل وقت الإضافة — الكلاينت يرجع لمحاولة الـregex كـfallback. */
  @Column({ name: 'embed_video_id', type: 'text', nullable: true })
  embedVideoId: string | null;

  @Column({ name: 'display_order', type: 'smallint', default: 0 })
  displayOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
