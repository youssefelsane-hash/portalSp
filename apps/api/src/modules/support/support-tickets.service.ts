import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AssignSupportTicketDto, UpdateSupportTicketStatusDto } from './dto/admin-update-support-ticket.dto';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { RateSupportTicketDto } from './dto/rate-support-ticket.dto';
import { SupportTicket, SupportTicketPriority, SupportTicketStatus } from './entities/support-ticket.entity';

// انتقالات بسيطة — مفيش تعقيد state machine كامل زي orders/complaints لأن القاموس (§8.4) مايوصفش
// دورة حياة صارمة للتذكرة العامة، بس منطقياً: closed نهائية، وممكن تفتح تاني من resolved (reopen).
const ALLOWED_TRANSITIONS: Record<SupportTicketStatus, SupportTicketStatus[]> = {
  [SupportTicketStatus.OPEN]: [SupportTicketStatus.IN_PROGRESS, SupportTicketStatus.RESOLVED, SupportTicketStatus.CLOSED],
  [SupportTicketStatus.IN_PROGRESS]: [SupportTicketStatus.RESOLVED, SupportTicketStatus.CLOSED],
  [SupportTicketStatus.RESOLVED]: [SupportTicketStatus.IN_PROGRESS, SupportTicketStatus.CLOSED],
  [SupportTicketStatus.CLOSED]: [],
};

@Injectable()
export class SupportTicketsService {
  constructor(
    @InjectRepository(SupportTicket) private readonly tickets: Repository<SupportTicket>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
  ) {}

  private async nextTicketNumber(manager: EntityManager): Promise<string> {
    const [{ next_human_readable_number: number }] = await manager.query<
      { next_human_readable_number: string }[]
    >("SELECT next_human_readable_number('TKT')");
    return number;
  }

  async create(user: JwtPayload, dto: CreateSupportTicketDto): Promise<SupportTicket> {
    return this.dataSource.transaction(async (manager) => {
      const ticketNumber = await this.nextTicketNumber(manager);
      const ticket = manager.create(SupportTicket, {
        ticketNumber,
        userId: user.sub,
        subject: dto.subject,
        category: dto.category,
        priority: dto.priority ?? SupportTicketPriority.MEDIUM,
        ticketStatus: SupportTicketStatus.OPEN,
        channel: dto.channel,
      });
      await manager.save(ticket);
      return ticket;
    });
  }

  private async findOrThrow(id: string): Promise<SupportTicket> {
    const ticket = await this.tickets.findOne({ where: { id } });
    if (!ticket) {
      throw new ApiException(ErrorCode.VAL_001, 'تذكرة الدعم غير موجودة', HttpStatus.NOT_FOUND);
    }
    return ticket;
  }

  async getForUser(user: JwtPayload, id: string): Promise<SupportTicket> {
    const ticket = await this.findOrThrow(id);
    if (user.userType !== UserType.ADMIN && ticket.userId !== user.sub) {
      throw new ApiException(ErrorCode.AUTH_001, 'التذكرة دي مش بتاعتك', HttpStatus.FORBIDDEN);
    }
    return ticket;
  }

  listMine(userId: string): Promise<SupportTicket[]> {
    return this.tickets.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  listAllForAdmin(status?: SupportTicketStatus): Promise<SupportTicket[]> {
    return this.tickets.find({
      where: status ? { ticketStatus: status } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async assign(adminUserId: string, id: string, dto: AssignSupportTicketDto, meta?: AuditActorMeta): Promise<SupportTicket> {
    const ticket = await this.findOrThrow(id);
    const previousAssignee = ticket.assignedToUserId;
    ticket.assignedToUserId = dto.assigned_to_user_id;
    if (!ticket.firstResponseAt) {
      ticket.firstResponseAt = new Date();
    }
    await this.tickets.save(ticket);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'support_ticket.assigned',
      entityType: 'support_ticket',
      entityId: ticket.id,
      oldValues: { assigned_to_user_id: previousAssignee },
      newValues: { assigned_to_user_id: ticket.assignedToUserId },
      meta,
    });
    return ticket;
  }

  async updateStatus(
    adminUserId: string,
    id: string,
    dto: UpdateSupportTicketStatusDto,
    meta?: AuditActorMeta,
  ): Promise<SupportTicket> {
    const ticket = await this.findOrThrow(id);
    if (!ALLOWED_TRANSITIONS[ticket.ticketStatus].includes(dto.ticket_status)) {
      throw new ApiException(
        ErrorCode.VAL_001,
        `مينفعش تنقل تذكرة من ${ticket.ticketStatus} لـ ${dto.ticket_status}`,
        HttpStatus.CONFLICT,
      );
    }
    const previousStatus = ticket.ticketStatus;
    ticket.ticketStatus = dto.ticket_status;
    if (dto.ticket_status === SupportTicketStatus.RESOLVED) {
      ticket.resolvedAt = new Date();
    } else if (dto.ticket_status === SupportTicketStatus.IN_PROGRESS && previousStatus === SupportTicketStatus.RESOLVED) {
      ticket.resolvedAt = null; // reopen
    }
    await this.tickets.save(ticket);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'support_ticket.status_changed',
      entityType: 'support_ticket',
      entityId: ticket.id,
      oldValues: { ticket_status: previousStatus },
      newValues: { ticket_status: ticket.ticketStatus },
      meta,
    });
    return ticket;
  }

  async rate(user: JwtPayload, id: string, dto: RateSupportTicketDto): Promise<SupportTicket> {
    const ticket = await this.getForUser(user, id);
    if (ticket.ticketStatus !== SupportTicketStatus.RESOLVED && ticket.ticketStatus !== SupportTicketStatus.CLOSED) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'ميقنش تقيّم تذكرة لسه ماتحلتش',
        HttpStatus.CONFLICT,
      );
    }
    if (ticket.satisfactionRating !== null) {
      throw new ApiException(ErrorCode.VAL_001, 'التذكرة دي اتقيّمت قبل كده', HttpStatus.CONFLICT);
    }
    ticket.satisfactionRating = dto.satisfaction_rating;
    await this.tickets.save(ticket);
    return ticket;
  }
}
