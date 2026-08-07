import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('service_categories')
export class ServiceCategory {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'parent_category_id', type: 'uuid', nullable: true })
  parentCategoryId: string | null;

  @Column({ name: 'name_ar', type: 'varchar', length: 120 })
  nameAr: string;

  @Column({ name: 'name_en', type: 'varchar', length: 120 })
  nameEn: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  slug: string;

  @Column({ name: 'description_ar', type: 'text', nullable: true })
  descriptionAr: string | null;

  @Column({ name: 'icon_url', type: 'text', nullable: true })
  iconUrl: string | null;

  @Column({ name: 'display_order', type: 'smallint', default: 0 })
  displayOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'is_featured', type: 'boolean', default: false })
  isFeatured: boolean;

  @Column({ name: 'launch_phase', type: 'smallint', default: 1 })
  launchPhase: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
