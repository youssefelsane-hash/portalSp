import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum TechnicianScheduleSlotStatus {
  AVAILABLE = 'available',
  BOOKED = 'booked',
  BLOCKED = 'blocked',
}

// سلوت جدولة فني حقيقي — راجع docs/08 §2 وADR-0002. صف صريح (مش نمط تكراري) لكل فترة الفني
// حدد إنه فاضي/محجوز/إجازة فيها.
@Entity('technician_schedule_slots')
export class TechnicianScheduleSlot {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ name: 'slot_date', type: 'date' })
  slotDate: string;

  @Column({ name: 'start_time', type: 'time' })
  startTime: string;

  @Column({ name: 'end_time', type: 'time' })
  endTime: string;

  @Column({ type: 'enum', enum: TechnicianScheduleSlotStatus, enumName: 'technician_schedule_slot_status', default: TechnicianScheduleSlotStatus.AVAILABLE })
  status: TechnicianScheduleSlotStatus;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'notes_ar', type: 'varchar', length: 200, nullable: true })
  notesAr: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
