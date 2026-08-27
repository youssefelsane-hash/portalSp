import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum WorkSessionStatus {
  /** زيارة حصلت والفني وقف فيها ولسه هيكمّل — `pauseReason` إلزامي. */
  COMPLETED_PARTIAL = 'completed_partial',
  /** زيارة جاية متفق عليها — بتحجز طاقة الفني في اليوم ده. */
  SCHEDULED = 'scheduled',
}

/**
 * زيارة واحدة لطلب (ADR-0047، migration 0209).
 *
 * الطلب كان دايمًا **زيارة واحدة** في النموذج. الجدول ده بيكسر الافتراض ده لسبب واقعي: الفني
 * بيكتشف وسط الشغل إنه محتاج قطعة غيار نادرة ومحتاج يرجع يوم تاني. من غير التمثيل ده، قدّامه
 * خيارين وحشين بس — يقفل الطلب كأنه خلص (بيكسر التقييم والضمان والفلوس)، أو يسيبه مفتوح بلا
 * معلومة (بيبان «متأخر» والعميل مش عارف حصل إيه).
 *
 * **حالة الطلب بتفضل `in_progress`** والفني بيفضل مربوط بيه — الشغل فعلاً شغّال، مجرد إنه
 * متقسّم على أيام. راجع ADR-0047 لسبب رفض إضافة حالة طلب جديدة.
 */
@Entity('order_work_sessions')
export class OrderWorkSession {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  /** `date` مش `timestamptz` — الجدولة في المشروع كله باليوم مش بالساعة (ADR-0018 §2). */
  @Column({ name: 'session_date', type: 'date' })
  sessionDate: string;

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status: WorkSessionStatus;

  /** السبب بيتعرض للعميل حرفيًا — مش تصنيف داخلي. */
  @Column({ name: 'pause_reason', type: 'text', nullable: true })
  pauseReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
