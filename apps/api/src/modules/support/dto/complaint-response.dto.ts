import { Complaint } from '../entities/complaint.entity';
import { ComplaintMessage } from '../entities/complaint-message.entity';

export interface ComplaintResponseDto {
  id: string;
  complaint_number: string;
  order_id: string | null;
  category: string;
  severity: string;
  title: string;
  description: string;
  complaint_status: string;
  resolution_type: string | null;
  resolution_notes: string | null;
  compensation_cents: number;
  sla_due_at: string;
  resolved_at: string | null;
  created_at: string;
}

export function toComplaintResponseDto(complaint: Complaint): ComplaintResponseDto {
  return {
    id: complaint.id,
    complaint_number: complaint.complaintNumber,
    order_id: complaint.orderId,
    category: complaint.category,
    severity: complaint.severity,
    title: complaint.title,
    description: complaint.description,
    complaint_status: complaint.complaintStatus,
    resolution_type: complaint.resolutionType,
    resolution_notes: complaint.resolutionNotes,
    compensation_cents: complaint.compensationCents,
    sla_due_at: complaint.slaDueAt.toISOString(),
    resolved_at: complaint.resolvedAt ? complaint.resolvedAt.toISOString() : null,
    created_at: complaint.createdAt.toISOString(),
  };
}

export interface ComplaintMessageResponseDto {
  id: string;
  sender_user_id: string;
  sender_role: string;
  message: string;
  is_internal_note: boolean;
  created_at: string;
}

export function toComplaintMessageResponseDto(message: ComplaintMessage): ComplaintMessageResponseDto {
  return {
    id: message.id,
    sender_user_id: message.senderUserId,
    sender_role: message.senderRole,
    message: message.message,
    is_internal_note: message.isInternalNote,
    created_at: message.createdAt.toISOString(),
  };
}
