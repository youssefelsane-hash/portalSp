import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export enum WebhookProcessingStatus {
  RECEIVED = 'received',
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  FAILED = 'failed',
  IGNORED = 'ignored',
  MANUAL_REVIEW = 'manual_review',
}

export enum WebhookProcessingStage {
  FINANCIAL = 'financial',
  EFFECTS = 'effects',
}

// سجل delivery خارجي مستقل عن Payment: يحتفظ بالهوية وحالة المعالجة حتى يمكن منع التكرار
// واسترداد الفشل العابر من غير افتراض أن إعادة إرسال webhook تعني عملية مالية جديدة.
@Entity('webhook_events')
@Index('uq_webhook_events_provider_external_event', ['provider', 'externalEventId'], { unique: true })
export class WebhookEvent {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'provider', type: 'varchar', length: 40 })
  provider: string;

  @Column({ name: 'event_type', type: 'varchar', length: 80 })
  eventType: string;

  // فريد داخل provider بعينه فقط؛ قد تستخدم بوابتان نفس المرجع الخارجي من غير أن يكونا نفس
  // الحدث. القيد المركب مع provider يمنع التكرار الحقيقي من نفس البوابة.
  @Column({ name: 'external_event_id', type: 'varchar', length: 120 })
  externalEventId: string;

  @Column({ name: 'payload', type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ name: 'signature_valid', type: 'boolean' })
  signatureValid: boolean;

  @Column({
    name: 'processing_status',
    type: 'enum',
    enum: WebhookProcessingStatus,
    enumName: 'webhook_processing_status',
    default: WebhookProcessingStatus.RECEIVED,
  })
  processingStatus: WebhookProcessingStatus;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'retry_count', type: 'smallint', default: 0 })
  retryCount: number;

  @Column({ name: 'processing_stage', type: 'varchar', length: 20, default: WebhookProcessingStage.FINANCIAL })
  processingStage: WebhookProcessingStage;

  @Column({ name: 'effects_payload', type: 'jsonb', nullable: true })
  effectsPayload: Record<string, unknown> | null;

  @Column({ name: 'effects_delivered_at', type: 'timestamptz', nullable: true })
  effectsDeliveredAt: Date | null;

  // وقت امتلاك محاولة المعالجة للحدث. منفصل عن processedAt لأن الأخير لا يُكتب إلا لما الحدث
  // يوصل لحالة نهائية، بينما المحاولة قد تتوقف/ينهار الـprocess في منتصفها وتحتاج recovery.
  @Column({ name: 'processing_started_at', type: 'timestamptz', nullable: true })
  processingStartedAt: Date | null;

  // الموعد التالي المسموح فيه لمحاولة recovery المحدودة. null مع FAILED يعني الحد الأقصى
  // للمحاولات انتهى ويحتاج الحدث مراجعة تشغيلية، وليس retry لا نهائيًا.
  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
  nextRetryAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
