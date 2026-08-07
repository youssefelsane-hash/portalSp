import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { OrderStatus } from './order.entity';

export enum OrderChangeSource {
  CUSTOMER = 'customer',
  TECHNICIAN = 'technician',
  ADMIN = 'admin',
  SYSTEM = 'system',
  WEBHOOK = 'webhook',
}

// إلزامي — سجل كل تغيير حالة، من غير استثناء (docs/02-data-dictionary.md §6.3)
@Entity('order_status_history')
export class OrderStatusHistory {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'previous_status', type: 'enum', enum: OrderStatus, enumName: 'order_status', nullable: true })
  previousStatus: OrderStatus | null;

  @Column({ name: 'new_status', type: 'enum', enum: OrderStatus, enumName: 'order_status' })
  newStatus: OrderStatus;

  @Column({ name: 'changed_by_user_id', type: 'uuid', nullable: true })
  changedByUserId: string | null;

  @Column({ name: 'changed_by_role', type: 'varchar', length: 40, nullable: true })
  changedByRole: string | null;

  @Column({ name: 'change_source', type: 'enum', enum: OrderChangeSource, enumName: 'order_change_source' })
  changeSource: OrderChangeSource;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
