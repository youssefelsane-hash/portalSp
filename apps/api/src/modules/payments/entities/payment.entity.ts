import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export enum PaymentMethod {
  CASH = 'cash',
  CARD = 'card',
  WALLET = 'wallet',
  BANK_TRANSFER = 'bank_transfer',
  CORPORATE_CREDIT = 'corporate_credit',
  // كود مرجعي FawryPay ("ادفع في أقرب فوري") — دفع فعلي كاش في نقطة بيع حقيقية، بس بدأ أونلاين
  // ومتابَع عبر webhook زي الدفع بالبطاقة، عكس `cash` (اللي بيتحصّل يدوياً من الفني مباشرة).
  // مضافة في infra/migrations/0042_fawry_payment_method.sql.
  FAWRY_REFERENCE = 'fawry_reference',
  // مسبق الدفع، تأكيد يدوي بس (ADR-0013 §7) — مفيش webhook تلقائي، موظف Finance بيأكّد الاستلام
  // (`POST /admin/payments/:id/confirm-instapay`، صلاحية payments.confirm_manual مخصوصة).
  // مضافة في infra/migrations/0091_instapay_payment_method.sql.
  INSTAPAY = 'instapay',
}

export enum PaymentGatewayStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  REFUNDED = 'refunded',
  // استرداد جزئي حقيقي (ADR-0013 §9) — الدفعة لسه معتبرة "نجحت" جزئيًا، مش REFUNDED بالكامل.
  // مضافة في infra/migrations/0094_payment_gateway_status_partially_refunded.sql.
  PARTIALLY_REFUNDED = 'partially_refunded',
}

@Entity('payments')
export class Payment {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'payment_number', type: 'varchar', length: 24, unique: true })
  paymentNumber: string;

  // NULL لو الدفعة دي لحجز خدمة منزلية بدل طلب — راجع domesticWorkerBookingId تحت. بالظبط واحد
  // من الاتنين مش NULL (قيد CHECK في migration 0149، docs/adr/0019).
  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents: number;

  @Column({ name: 'currency_code', type: 'varchar', length: 3, default: 'EGP' })
  currencyCode: string;

  @Column({ name: 'payment_method', type: 'enum', enum: PaymentMethod, enumName: 'payment_method' })
  paymentMethod: PaymentMethod;

  @Column({ name: 'payment_gateway', type: 'varchar', length: 40, nullable: true })
  paymentGateway: string | null;

  @Column({ name: 'gateway_transaction_id', type: 'varchar', length: 120, nullable: true })
  gatewayTransactionId: string | null;

  // كان عمود موجود في 0008_finance.sql من أول يوم بس غير مربوط بالـ entity — أول استخدام حقيقي
  // ليه هنا لتخزين كود Fawry المرجعي (مختلف عن gateway_transaction_id اللي هو رقم عملية البوابة).
  @Column({ name: 'gateway_reference', type: 'varchar', length: 120, nullable: true })
  gatewayReference: string | null;

  @Column({ name: 'gateway_response', type: 'jsonb', nullable: true })
  gatewayResponse: Record<string, unknown> | null;

  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: PaymentGatewayStatus,
    enumName: 'payment_gateway_status',
    default: PaymentGatewayStatus.PENDING,
  })
  paymentStatus: PaymentGatewayStatus;

  @Column({ name: 'failure_code', type: 'varchar', length: 60, nullable: true })
  failureCode: string | null;

  @Column({ name: 'failure_message', type: 'text', nullable: true })
  failureMessage: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 80, unique: true })
  idempotencyKey: string;

  @CreateDateColumn({ name: 'initiated_at', type: 'timestamptz' })
  initiatedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt: Date | null;

  // InstaPay بس — العميل ضغط "حوّلت الفلوس" فعليًا (migration 0145). بيفرّق للأدمن بين دفعة
  // محدش لمسها ودفعة العميل بيدّعي إنه حوّلها، بلا ما يبقى تأكيد فعلي (ده لسه بيتم بس عبر
  // confirmInstaPayPayment من الأدمن).
  @Column({ name: 'customer_confirmed_transfer_at', type: 'timestamptz', nullable: true })
  customerConfirmedTransferAt: Date | null;

  @Column({ name: 'collected_by_user_id', type: 'uuid', nullable: true })
  collectedByUserId: string | null;

  // مربوطة بدفعة order_items.batch_id لو دي محاولة تحصيل شغل إضافي (docs/08 §21) — null للدفعة
  // الأصلية للطلب. finalizeGatewayWebhook() بيستخدمه عشان يعرف يوجّه صح (مايستدعيش settleAndComplete
  // للدفعات دي — الطلب لسه شغال، مش بيقفل).
  @Column({ name: 'order_item_batch_id', type: 'uuid', nullable: true })
  orderItemBatchId: string | null;

  // إعادة استخدام تدفق InstaPay اليدوي الموجود لحجوزات الخدمات المنزلية بدل نظام دفع مواز
  // (docs/adr/0019) — NULL لو الدفعة دي لطلب عادي. mutually exclusive مع orderId عبر CHECK.
  @Column({ name: 'domestic_worker_booking_id', type: 'uuid', nullable: true })
  domesticWorkerBookingId: string | null;
}
