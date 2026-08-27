import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// ملاحظات داخلية على الطلب لمركز الاتصال (docs/08 §73 بند 3) — نفس نمط
// support/entities/complaint-message.entity.ts's isInternalNote بالحرف، بس هنا كل الصفوف داخلية
// بتعريفها (جدول مستقل، مش عمود على orders) — العميل/الفني مالهومش أي وصول لها خالص.
@Entity('order_internal_notes')
export class OrderInternalNote {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'author_user_id', type: 'uuid' })
  authorUserId: string;

  @Column({ type: 'text' })
  note: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
