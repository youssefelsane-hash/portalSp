import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import { OrderSourceChannel } from '../../orders/entities/order.entity';

/**
 * المراحل بترتيب الرحلة الفعلي. الترتيب هنا **هو** ترتيب الفنل في التقرير — مفيش قايمة تانية
 * في أي مكان تاني تقدر تفرق عنه.
 */
export const FUNNEL_STAGES = [
  'service_viewed',
  'booking_started',
  'price_previewed',
  'providers_viewed',
  'order_placed',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/** المراحل اللي بتتحسب من `order_status_history` مش من الجدول ده (ADR-0075 §3). */
export const DERIVED_FUNNEL_STAGES = ['technician_assigned', 'technician_arrived', 'order_completed'] as const;
export type DerivedFunnelStage = (typeof DERIVED_FUNNEL_STAGES)[number];

export type FunnelEventSource = 'client' | 'server';
export type FunnelEventOutcome = 'success' | 'failed';

// مطابق لـ infra/migrations/0272_booking_funnel_events.sql
@Entity('booking_funnel_events')
export class BookingFunnelEvent {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'funnel_session_id', type: 'uuid', nullable: true })
  funnelSessionId: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 30 })
  stage: FunnelStage;

  @Column({ type: 'varchar', length: 10 })
  source: FunnelEventSource;

  @Column({ type: 'varchar', length: 10, default: 'success' })
  outcome: FunnelEventOutcome;

  @Column({ name: 'failure_reason', type: 'varchar', length: 120, nullable: true })
  failureReason: string | null;

  @Column({ name: 'service_id', type: 'uuid', nullable: true })
  serviceId: string | null;

  @Column({ name: 'city_id', type: 'uuid', nullable: true })
  cityId: string | null;

  @Column({ name: 'client_channel', type: 'varchar', length: 20, default: OrderSourceChannel.CUSTOMER_APP })
  clientChannel: OrderSourceChannel;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz', default: () => 'now()' })
  occurredAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
