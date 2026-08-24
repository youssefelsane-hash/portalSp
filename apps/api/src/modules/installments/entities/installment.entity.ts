import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { InstallmentStatus } from './installment-status.enum';

// قسط واحد في الجدولة — sequence_number=0 هو المقدم (لو الخطة فيها مقدم)، و1..N الأقساط الدورية.
// الثابت: sum(amounts) + المقدم(=صف 0 لو موجود) === الإجمالي الممول، مفروض بالـCHECK
// assertBreakdownInvariant قبل الإنشاء.
@Entity('installments')
export class Installment {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'application_id', type: 'uuid' })
  applicationId: string;

  @Column({ name: 'sequence_number', type: 'integer' })
  sequenceNumber: number;

  @Column({ name: 'due_at', type: 'timestamptz' })
  dueAt: Date;

  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents: number;

  @Column({ type: 'varchar', length: 12, default: InstallmentStatus.SCHEDULED })
  status: InstallmentStatus;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount: number;

  /** آخر دفعة (Payment) مرتبطة بالمحاولة الأخيرة — webhook التأكيد بيرجع ليه. */
  @Column({ name: 'payment_id', type: 'uuid', nullable: true })
  paymentId: string | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'last_attempt_at', type: 'timestamptz', nullable: true })
  lastAttemptAt: Date | null;

  /** سبب آخر فشل تحصيل — تشغيلي للعميل/الأدمن (رسالة بوابة آمنة بلا أي بيانات حساسة). */
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
