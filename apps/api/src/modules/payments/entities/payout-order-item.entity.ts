import { Column, Entity, PrimaryColumn } from 'typeorm';

// مطابق لـ infra/migrations/0008_finance.sql — تفصيل الطلبات اللي اتجمّعت في دفعة صرف واحدة.
// كانت فجوة موثّقة: الجدول موجود من أول يوم بس مفيش كان بيتاخد عليه أي INSERT.
@Entity('payout_order_items')
export class PayoutOrderItem {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'payout_id', type: 'uuid' })
  payoutId: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'earning_cents', type: 'integer' })
  earningCents: number;

  @Column({ name: 'commission_cents', type: 'integer' })
  commissionCents: number;
}
