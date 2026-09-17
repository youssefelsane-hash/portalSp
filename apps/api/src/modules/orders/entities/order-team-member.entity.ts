import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق لـ infra/migrations/0060_order_team_members.sql — توزيع أدوار الفريق داخل الطلب
// الواحد (docs/08 §5). إضافي فوق orders.technician_id ("قائد الطلب")، مش بديل له.
@Entity('order_team_members')
export class OrderTeamMember {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ name: 'role_label', type: 'varchar', length: 100 })
  roleLabel: string;

  // بقت nullable في migration 0076 (ADR-0008) — التعيين اليدوي من الأدمن بعد تصعيد مطابقة مساعد
  // مالوش "فني مضيف" حقيقي، بيستخدم addedByAdminUserId بدلها. واحد منهم بس لازم يكون موجود
  // (CHECK constraint على مستوى الداتابيز، chk_order_team_members_added_by).
  @Column({ name: 'added_by_technician_id', type: 'uuid', nullable: true })
  addedByTechnicianId: string | null;

  @Column({ name: 'added_by_admin_user_id', type: 'uuid', nullable: true })
  addedByAdminUserId: string | null;

  // مطابق لـ infra/migrations/0070_assistant_pool_matching.sql (ADR-0007) — 'assistant' = اتوصل
  // عبر مطابقة المساعد التلقائية، 'team_member' (افتراضي) = إضافة يدوية من قائد الطلب في "اعتماد".
  /** **الطبقة المالية** (ADR-0050) — بتتفرض من `technician_kind`، ومنها بتتحسب نسبة المساعد. */
  @Column({ name: 'member_type', type: 'varchar', length: 20, default: 'team_member' })
  memberType: string;

  /**
   * **الخانة اللي اتملت** (ADR-0101) — `execution` من `required_technicians`، `helper` من
   * `required_assistants`.
   *
   * منفصل عن `memberType` عن قصد: مساعد بيملا خانة تنفيذ في خدمة مابتشترطش قائد فني بيتسجّل
   * `crew_slot='execution'` (فالطاقم بيكتمل) و`member_type='assistant'` (فالأجر مايتغيّرش).
   */
  @Column({ name: 'crew_slot', type: 'varchar', length: 20, default: 'execution' })
  crewSlot: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
