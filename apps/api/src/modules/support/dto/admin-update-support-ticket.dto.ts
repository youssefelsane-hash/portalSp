import { IsEnum, IsUUID } from 'class-validator';
import { SupportTicketStatus } from '../entities/support-ticket.entity';

export class AssignSupportTicketDto {
  @IsUUID()
  assigned_to_user_id: string;
}

export class UpdateSupportTicketStatusDto {
  @IsEnum(SupportTicketStatus)
  ticket_status: SupportTicketStatus;
}
