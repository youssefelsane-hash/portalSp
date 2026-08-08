// مطابق لـ apps/api/src/modules/support/entities/complaint.entity.ts وdto/*.ts
export type ComplaintCategory =
  | 'poor_quality'
  | 'late_arrival'
  | 'no_show'
  | 'overcharging'
  | 'rude_behavior'
  | 'damage_to_property'
  | 'incomplete_work'
  | 'safety_concern'
  | 'fraud'
  | 'other';

export type ComplaintSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ComplaintStatus =
  | 'open'
  | 'under_investigation'
  | 'awaiting_customer'
  | 'awaiting_technician'
  | 'resolved'
  | 'rejected'
  | 'escalated'
  | 'closed';

export type ComplaintResolutionType =
  | 'refund'
  | 'redo_service'
  | 'partial_refund'
  | 'warning_issued'
  | 'technician_suspended'
  | 'no_action';

export interface ComplaintResponseDto {
  id: string;
  complaint_number: string;
  order_id: string | null;
  category: ComplaintCategory;
  severity: ComplaintSeverity;
  title: string;
  description: string;
  complaint_status: ComplaintStatus;
  resolution_type: ComplaintResolutionType | null;
  resolution_notes: string | null;
  compensation_cents: number;
  sla_due_at: string;
  resolved_at: string | null;
  created_at: string;
}

export interface ComplaintMessageResponseDto {
  id: string;
  sender_user_id: string;
  sender_role: string;
  message: string;
  is_internal_note: boolean;
  created_at: string;
}

export interface ComplaintAttachmentResponseDto {
  id: string;
  file_url: string;
  file_type: string | null;
  uploaded_by_user_id: string;
  created_at: string;
}

export interface AddComplaintMessageBody {
  message: string;
  is_internal_note?: boolean;
}

export interface ResolveComplaintBody {
  resolution_type: ComplaintResolutionType;
  resolution_notes: string;
  compensation_cents?: number;
}

export interface RejectComplaintBody {
  resolution_notes: string;
}
