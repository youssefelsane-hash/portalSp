import { IsEnum, IsOptional } from 'class-validator';
import { SupportTicketStatus } from '../entities/support-ticket.entity';

export class ListSupportTicketsDto {
  @IsOptional()
  @IsEnum(SupportTicketStatus)
  ticket_status?: SupportTicketStatus;
}
