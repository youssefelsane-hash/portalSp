import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// متطلب مستندات لكل خطة — قابل للتهيئة بالكامل من الأدمن (doc_type مفتاح حر + label عربي)،
// مش enum hardcoded في تطبيقات العملاء. العميل بيشوف القايمة من الـAPI ويرفع على أساسها.
@Entity('installment_plan_document_requirements')
export class InstallmentPlanDocumentRequirement {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @Column({ name: 'doc_type', type: 'varchar', length: 40 })
  docType: string;

  @Column({ name: 'label_ar', type: 'varchar', length: 120 })
  labelAr: string;

  @Column({ name: 'is_required', type: 'boolean', default: true })
  isRequired: boolean;

  @Column({ name: 'display_order', type: 'smallint', default: 0 })
  displayOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
