import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export enum WebhookProcessingStatus {
  RECEIVED = 'received',
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  FAILED = 'failed',
  IGNORED = 'ignored',
}

// الجدول ده موجود في الشيما من أول يوم (infra/migrations/0011_system.sql، قاموس §11.3) —
// مفيش أي كود كان بيستخدمه لحد دلوقتي (فجوة موثّقة في payments/README.md). الـ entity هنا أول
// استهلاك حقيقي ليه، وقت ربط بوابة Paymob.
@Entity('webhook_events')
export class WebhookEvent {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'provider', type: 'varchar', length: 40 })
  provider: string;

  @Column({ name: 'event_type', type: 'varchar', length: 80 })
  eventType: string;

  // فريد عبر كل الأحداث — ده اللي بيمنع معالجة نفس الحدث مرتين لو البوابة أعادت إرسال نفس
  // الـ webhook (شائع جداً، كل بوابات الدفع بتعمل retry لو مستحملتش رد 200 بسرعة كفاية).
  @Column({ name: 'external_event_id', type: 'varchar', length: 120, unique: true })
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
