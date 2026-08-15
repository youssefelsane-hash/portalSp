import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum ComplaintCategory {
  POOR_QUALITY = 'poor_quality',
  LATE_ARRIVAL = 'late_arrival',
  NO_SHOW = 'no_show',
  OVERCHARGING = 'overcharging',
  RUDE_BEHAVIOR = 'rude_behavior',
  DAMAGE_TO_PROPERTY = 'damage_to_property',
  INCOMPLETE_WORK = 'incomplete_work',
  SAFETY_CONCERN = 'safety_concern',
  FRAUD = 'fraud',
  // العميل رفض شغل الفني وصفه كضروري لإتمام الطلب صح (docs/08 §22 بند 6) — مختلف عن NO_SHOW
  // (العميل مش موجود خالص). migration 0107 (ALTER TYPE complaint_category ADD VALUE).
  REQUIRED_WORK_REJECTED = 'required_work_rejected',
  OTHER = 'other',
}

export enum ComplaintSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum ComplaintStatus {
  OPEN = 'open',
  UNDER_INVESTIGATION = 'under_investigation',
  AWAITING_CUSTOMER = 'awaiting_customer',
  AWAITING_TECHNICIAN = 'awaiting_technician',
  RESOLVED = 'resolved',
  REJECTED = 'rejected',
  ESCALATED = 'escalated',
  CLOSED = 'closed',
}

export enum ComplaintResolutionType {
  REFUND = 'refund',
  REDO_SERVICE = 'redo_service',
  PARTIAL_REFUND = 'partial_refund',
  WARNING_ISSUED = 'warning_issued',
  TECHNICIAN_SUSPENDED = 'technician_suspended',
  NO_ACTION = 'no_action',
}

// الـ SLA وقت الرد الأول جزء أساسي من الجودة (§9 في الماستر بلان) — مش تفصيلة ثانوية
const DEFAULT_SLA_HOURS = 24;
export const COMPLAINT_DEFAULT_SLA_HOURS = DEFAULT_SLA_HOURS;

@Entity('complaints')
export class Complaint {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'complaint_number', type: 'varchar', length: 24, unique: true })
  complaintNumber: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'filed_by_user_id', type: 'uuid' })
  filedByUserId: string;

  @Column({ name: 'against_user_id', type: 'uuid', nullable: true })
  againstUserId: string | null;

  @Column({ type: 'enum', enum: ComplaintCategory, enumName: 'complaint_category' })
  category: ComplaintCategory;

  @Column({ type: 'enum', enum: ComplaintSeverity, enumName: 'complaint_severity', default: ComplaintSeverity.MEDIUM })
  severity: ComplaintSeverity;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'complaint_status', type: 'enum', enum: ComplaintStatus, enumName: 'complaint_status', default: ComplaintStatus.OPEN })
  complaintStatus: ComplaintStatus;

  @Column({ name: 'resolution_type', type: 'enum', enum: ComplaintResolutionType, enumName: 'complaint_resolution_type', nullable: true })
  resolutionType: ComplaintResolutionType | null;

  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  resolutionNotes: string | null;

  @Column({ name: 'compensation_cents', type: 'integer', default: 0 })
  compensationCents: number;

  @Column({ name: 'assigned_to_user_id', type: 'uuid', nullable: true })
  assignedToUserId: string | null;

  @Column({ name: 'sla_due_at', type: 'timestamptz' })
  slaDueAt: Date;

  @Column({ name: 'first_response_at', type: 'timestamptz', nullable: true })
  firstResponseAt: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId: string | null;

  @Column({ name: 'customer_satisfied', type: 'boolean', nullable: true })
  customerSatisfied: boolean | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
