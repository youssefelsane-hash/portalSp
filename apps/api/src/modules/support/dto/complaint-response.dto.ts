import { Complaint } from '../entities/complaint.entity';
import { ComplaintMessage } from '../entities/complaint-message.entity';

/**
 * **بَقّة حقيقية اتلقطت في تحقيق docs/08 §139 بند ٥** (المالك طلب «تأكد إن كل شكوى معروف من
 * صاحبها واتعملت ليه» — والتأكد طلّع إن الإجابة كانت لأ).
 *
 * `complaints` فيه `filed_by_user_id` و`against_user_id` من الأساس، لكن الـDTO ده مكانش
 * بيرجّعهم **خالص** — فأي شاشة أدمن كانت بتعرض شكوى **مجهولة الطرفين**: نص وتصنيف وخلاص،
 * من غير ما تعرف مين كاتبها ولا على مين. ده مش نقص عرض في الواجهة، ده حقل موجود في الجدول
 * واتنسى في العقد، فمستحيل أي واجهة تعرضه مهما اتعدّلت.
 *
 * الأسماء بتيجي من `users` بـjoin اختياري — `null` معناها المستخدم اتمسح (soft delete)، مش
 * إن الشكوى مجهولة.
 */
export interface ComplaintPartyDto {
  user_id: string;
  full_name: string | null;
  user_type: string | null;
}

export interface ComplaintResponseDto {
  id: string;
  complaint_number: string;
  order_id: string | null;
  /** مقدّم الشكوى — **مطلوب دايمًا** (العمود `NOT NULL`). */
  filed_by: ComplaintPartyDto;
  /** المشكو في حقه — `null` لو الشكوى على المنصة نفسها مش على شخص. */
  against: ComplaintPartyDto | null;
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

/** أسماء الأطراف — بتتحمّل من `SupportService` بـjoin واحد للقايمة كلها، مش استعلام لكل صف. */
export type ComplaintPartyNames = Map<string, { full_name: string | null; user_type: string | null }>;

export function toComplaintResponseDto(complaint: Complaint, names?: ComplaintPartyNames): ComplaintResponseDto {
  const party = (userId: string): ComplaintPartyDto => ({
    user_id: userId,
    full_name: names?.get(userId)?.full_name ?? null,
    user_type: names?.get(userId)?.user_type ?? null,
  });
  return {
    id: complaint.id,
    complaint_number: complaint.complaintNumber,
    order_id: complaint.orderId,
    filed_by: party(complaint.filedByUserId),
    against: complaint.againstUserId ? party(complaint.againstUserId) : null,
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
