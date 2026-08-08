import { SupportTicket } from '../entities/support-ticket.entity';

export interface SupportTicketResponseDto {
  id: string;
  ticket_number: string;
  user_id: string;
  subject: string;
  category: string;
  priority: string;
  ticket_status: string;
  channel: string;
  assigned_to_user_id: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  satisfaction_rating: number | null;
  created_at: string;
}

export function toSupportTicketResponseDto(ticket: SupportTicket): SupportTicketResponseDto {
  return {
    id: ticket.id,
    ticket_number: ticket.ticketNumber,
    user_id: ticket.userId,
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    ticket_status: ticket.ticketStatus,
    channel: ticket.channel,
    assigned_to_user_id: ticket.assignedToUserId,
    first_response_at: ticket.firstResponseAt ? ticket.firstResponseAt.toISOString() : null,
    resolved_at: ticket.resolvedAt ? ticket.resolvedAt.toISOString() : null,
    satisfaction_rating: ticket.satisfactionRating,
    created_at: ticket.createdAt.toISOString(),
  };
}
