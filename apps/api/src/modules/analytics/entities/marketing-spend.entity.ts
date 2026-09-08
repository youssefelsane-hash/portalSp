import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق لـ infra/migrations/0294_marketing_spend.sql
@Entity('marketing_spend')
export class MarketingSpend {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  /** أول يوم في الشهر — القيد في القاعدة بيفرض ده عشان مايبقاش لنفس الشهر صفين. */
  @Column({ type: 'date' })
  month: string;

  @Column({ type: 'varchar', length: 40 })
  channel: string;

  @Column({ name: 'amount_cents', type: 'int' })
  amountCents: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'recorded_by_user_id', type: 'uuid', nullable: true })
  recordedByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
