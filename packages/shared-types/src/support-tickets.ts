export type SupportTicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type SupportTicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type SupportChannel = 'app' | 'phone' | 'whatsapp' | 'email';

export interface SupportTicketResponseDto {
  id: string;
  ticket_number: string;
  user_id: string;
  subject: string;
  category: string;
  priority: SupportTicketPriority;
  ticket_status: SupportTicketStatus;
  channel: SupportChannel;
  assigned_to_user_id: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  satisfaction_rating: number | null;
  created_at: string;
}

export interface AssignSupportTicketBody {
  assigned_to_user_id: string;
}

export interface UpdateSupportTicketStatusBody {
  ticket_status: SupportTicketStatus;
}
