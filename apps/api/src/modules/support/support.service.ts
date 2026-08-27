import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { safeExtensionForFile } from '../../common/storage/file-signature-validator';
import { uploadWithOrphanCleanup } from '../../common/storage/upload-with-orphan-cleanup.util';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { COMPLAINT_FILED_EVENT, ComplaintFiledEvent } from '../../common/events/complaint-filed.event';
import { COMPLAINT_MESSAGE_ADDED_EVENT, ComplaintMessageAddedEvent } from '../../common/events/complaint-message-added.event';
import { COMPLAINT_STATUS_CHANGED_EVENT, ComplaintStatusChangedEvent } from '../../common/events/complaint-status-changed.event';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { TechniciansService } from '../technicians/technicians.service';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { Order } from '../orders/entities/order.entity';
import { PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from '../payments/entities/wallet.entity';
import { WalletTxType } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { AddComplaintMessageDto, FileComplaintDto, RejectComplaintDto, ResolveComplaintDto } from './dto/file-complaint.dto';
import { UpdateComplaintSeverityDto } from './dto/update-complaint-severity.dto';
import { Complaint, COMPLAINT_DEFAULT_SLA_HOURS, ComplaintCategory, ComplaintSeverity, ComplaintStatus } from './entities/complaint.entity';
import { ComplaintAttachment } from './entities/complaint-attachment.entity';
import { ComplaintMessage } from './entities/complaint-message.entity';
import { canTransitionComplaint } from './complaint-state-machine';

export interface IncomingComplaintFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

const SLA_HOURS_BY_SEVERITY: Record<ComplaintSeverity, number> = {
  [ComplaintSeverity.CRITICAL]: 4,
  [ComplaintSeverity.HIGH]: 8,
  [ComplaintSeverity.MEDIUM]: COMPLAINT_DEFAULT_SLA_HOURS,
  [ComplaintSeverity.LOW]: 48,
};

/**
 * كانت فجوة موثّقة صراحة ("كله medium ثابت، التصنيف الدقيق مسؤولية فريق الدعم يدوياً وقت
 * المراجعة") — التصنيف الأولي دلوقتي بيتحدد حسب الفئة (تصنيف منطقي بديهي: خطر جسدي/مالي حقيقي
 * = أعلى، جودة خدمة = وسط)، وفريق الدعم لسه قادر يعدّله يدوياً بعد المراجعة عبر
 * `PATCH /admin/complaints/:id/severity` (تحت) — التصنيف التلقائي نقطة بداية أدق من "medium"
 * ثابت للكل، مش بديل نهائي عن مراجعة بشرية.
 */
const SEVERITY_BY_CATEGORY: Record<ComplaintCategory, ComplaintSeverity> = {
  [ComplaintCategory.SAFETY_CONCERN]: ComplaintSeverity.CRITICAL,
  [ComplaintCategory.FRAUD]: ComplaintSeverity.CRITICAL,
  [ComplaintCategory.DAMAGE_TO_PROPERTY]: ComplaintSeverity.CRITICAL,
  [ComplaintCategory.NO_SHOW]: ComplaintSeverity.HIGH,
  [ComplaintCategory.REQUIRED_WORK_REJECTED]: ComplaintSeverity.HIGH,
  [ComplaintCategory.OVERCHARGING]: ComplaintSeverity.HIGH,
  [ComplaintCategory.RUDE_BEHAVIOR]: ComplaintSeverity.HIGH,
  [ComplaintCategory.POOR_QUALITY]: ComplaintSeverity.MEDIUM,
  [ComplaintCategory.INCOMPLETE_WORK]: ComplaintSeverity.MEDIUM,
  [ComplaintCategory.LATE_ARRIVAL]: ComplaintSeverity.MEDIUM,
  [ComplaintCategory.OTHER]: ComplaintSeverity.LOW,
};

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(Complaint) private readonly complaints: Repository<Complaint>,
    @InjectRepository(ComplaintMessage) private readonly messages: Repository<ComplaintMessage>,
    @InjectRepository(ComplaintAttachment) private readonly attachments: Repository<ComplaintAttachment>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly walletsService: WalletsService,
    private readonly auditLog: AuditLogService,
    private readonly events: EventEmitter2,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  private async nextComplaintNumber(manager: EntityManager): Promise<string> {
    const [{ next_human_readable_number: number }] = await manager.query<
      { next_human_readable_number: string }[]
    >("SELECT next_human_readable_number('CMP')");
    return number;
  }

  async fileComplaint(user: JwtPayload, dto: FileComplaintDto): Promise<Complaint> {
    let againstUserId: string | null = null;

    if (dto.order_id) {
      const order = await this.orders.findOne({ where: { id: dto.order_id } });
      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      }

      const isCustomer =
        user.userType === UserType.CUSTOMER &&
        (await this.customerProfiles.findByUserIdOrThrow(user.sub)).id === order.customerId;
      const isTechnician =
        user.userType === UserType.TECHNICIAN &&
        order.technicianId !== null &&
        (await this.techniciansService.findByUserIdOrThrow(user.sub)).id === order.technicianId;

      if (!isCustomer && !isTechnician) {
        throw new ApiException(ErrorCode.AUTH_001, 'الطلب ده مش بتاعك', HttpStatus.FORBIDDEN);
      }

      // الطرف التاني في الطلب بيتحدد أوتوماتيك — الشكوى غالباً على الطرف التاني
      if (isCustomer && order.technicianId) {
        againstUserId = (await this.techniciansService.findByProfileIdOrThrow(order.technicianId)).userId;
      } else if (isTechnician) {
        againstUserId = (await this.customerProfiles.findByProfileIdOrThrow(order.customerId)).userId;
      }
    }

    const complaint = await this.dataSource.transaction(async (manager) => {
      const complaintNumber = await this.nextComplaintNumber(manager);
      const severity = SEVERITY_BY_CATEGORY[dto.category];
      const complaint = manager.create(Complaint, {
        complaintNumber,
        orderId: dto.order_id ?? null,
        filedByUserId: user.sub,
        againstUserId,
        category: dto.category,
        severity,
        title: dto.title,
        description: dto.description,
        complaintStatus: ComplaintStatus.OPEN,
        compensationCents: 0,
        slaDueAt: new Date(Date.now() + SLA_HOURS_BY_SEVERITY[severity] * 60 * 60 * 1000),
      });
      await manager.save(complaint);

      if (dto.order_id) {
        await manager.update(Order, dto.order_id, { hasComplaint: true });
      }

      return complaint;
    });

    // بره الـ transaction عمداً — نفس فلسفة order.created، مفيش داعي أي مستمع يشتغل على بيانات مش مؤكّدة
    this.events.emit(COMPLAINT_FILED_EVENT, new ComplaintFiledEvent(complaint.id, complaint.complaintNumber, complaint.title));
    return complaint;
  }

  private async findOrThrow(complaintId: string): Promise<Complaint> {
    const complaint = await this.complaints.findOne({ where: { id: complaintId } });
    if (!complaint) {
      throw new ApiException(ErrorCode.VAL_001, 'الشكوى غير موجودة', HttpStatus.NOT_FOUND);
    }
    return complaint;
  }

  private isParticipant(user: JwtPayload, complaint: Complaint): boolean {
    return user.userType === UserType.ADMIN || complaint.filedByUserId === user.sub || complaint.againstUserId === user.sub;
  }

  async getForUser(user: JwtPayload, complaintId: string): Promise<Complaint> {
    const complaint = await this.findOrThrow(complaintId);
    if (!this.isParticipant(user, complaint)) {
      throw new ApiException(ErrorCode.AUTH_001, 'الشكوى دي مش بتاعتك', HttpStatus.FORBIDDEN);
    }
    return complaint;
  }

  async listMine(userId: string): Promise<Complaint[]> {
    return this.complaints
      .createQueryBuilder('c')
      .where('c.filedByUserId = :userId OR c.againstUserId = :userId', { userId })
      .orderBy('c.createdAt', 'DESC')
      .getMany();
  }

  async listAllForAdmin(): Promise<Complaint[]> {
    return this.complaints.find({ order: { createdAt: 'DESC' } });
  }

  async addMessage(user: JwtPayload, complaintId: string, dto: AddComplaintMessageDto): Promise<ComplaintMessage> {
    const complaint = await this.getForUser(user, complaintId);

    // ملاحظة داخلية بس لفريق الدعم — أي حد تاني يبعتها بتتحول تلقائياً لرسالة عادية، مش بيتقبل منه أصلاً
    const isInternalNote = user.userType === UserType.ADMIN && (dto.is_internal_note ?? false);

    const message = this.messages.create({
      complaintId: complaint.id,
      senderUserId: user.sub,
      senderRole: user.userType,
      message: dto.message,
      isInternalNote,
    });
    await this.messages.save(message);

    if (!complaint.firstResponseAt && user.userType === UserType.ADMIN) {
      complaint.firstResponseAt = new Date();
      await this.complaints.save(complaint);
    }

    // بلاغ مالك صريح (docs/08 §73 بند 2): رد الأدمن كان بيوصل كرسالة بس من غير أي إشعار لصاحب
    // الشكوى. ملاحظة داخلية (isInternalNote) مبتتصدّرش عمداً — العميل/الفني مش المفروض يعرفوا
    // بوجودها أصلاً. "لا تبلّغ نفسك" دفاعي — أدمن عمره ما يبقى هو صاحب الشكوى فعليًا.
    if (user.userType === UserType.ADMIN && !isInternalNote && complaint.filedByUserId !== user.sub) {
      this.events.emit(
        COMPLAINT_MESSAGE_ADDED_EVENT,
        new ComplaintMessageAddedEvent(complaint.id, complaint.complaintNumber, complaint.filedByUserId),
      );
    }

    return message;
  }

  async listMessages(user: JwtPayload, complaintId: string): Promise<ComplaintMessage[]> {
    const complaint = await this.getForUser(user, complaintId);
    const all = await this.messages.find({ where: { complaintId: complaint.id }, order: { createdAt: 'ASC' } });
    // العميل/الفني ميشوفوش ملاحظات فريق الدعم الداخلية
    return user.userType === UserType.ADMIN ? all : all.filter((m) => !m.isInternalNote);
  }

  /**
   * حل الشكوى — لو فيه تعويض، بيتحوّل فعلياً لمحفظة صاحب الشكوى جوّه نفس الـ transaction اللي
   * بتقفل الشكوى، عشان "الشكوى اتقفلت والتعويض ماتحولش" ميحصلش. الـ state machine بمنع حل شكوى
   * اتحلت قبل كده أصلاً (RESOLVED مالهاش انتقال لـ RESOLVED تاني) — دي حماية مزدوجة ضد تعويض مكرر.
   */
  async resolve(
    adminUserId: string,
    complaintId: string,
    dto: ResolveComplaintDto,
    meta?: AuditActorMeta,
  ): Promise<Complaint> {
    const filerWalletOwnerType =
      (await this.resolveUserTypeOf((await this.findOrThrow(complaintId)).filedByUserId)) === UserType.TECHNICIAN
        ? WalletOwnerType.TECHNICIAN
        : WalletOwnerType.CUSTOMER;
    const result = await this.dataSource.transaction(async (manager) => {
      const complaint = await manager
        .createQueryBuilder(Complaint, 'complaint')
        .setLock('pessimistic_write')
        .where('complaint.id = :complaintId', { complaintId })
        .getOne();
      if (!complaint) {
        throw new ApiException(ErrorCode.VAL_001, 'الشكوى غير موجودة', HttpStatus.NOT_FOUND);
      }
      if (!canTransitionComplaint(complaint.complaintStatus, ComplaintStatus.RESOLVED)) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `مينفعش تحل شكوى في حالة ${complaint.complaintStatus}`,
          HttpStatus.CONFLICT,
        );
      }
      const previousStatus = complaint.complaintStatus;

      const compensationCents = dto.compensation_cents ?? 0;
      if (compensationCents > 0) {
        const filerWallet = await this.walletsService.getOrCreateWallet(
          complaint.filedByUserId,
          filerWalletOwnerType,
          manager,
        );
        const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID, manager);

        await this.walletsService.doubleEntry(
          {
            fromWalletId: platformWallet.id,
            toWalletId: filerWallet.id,
            amountCents: compensationCents,
            transactionType: WalletTxType.ADJUSTMENT,
            referenceType: 'complaint',
            referenceId: complaint.id,
            descriptionAr: `تعويض شكوى ${complaint.complaintNumber}`,
            allowNegativeBalance: true,
          },
          manager,
        );
      }

      complaint.complaintStatus = ComplaintStatus.RESOLVED;
      complaint.resolutionType = dto.resolution_type;
      complaint.resolutionNotes = dto.resolution_notes;
      complaint.compensationCents = compensationCents;
      complaint.resolvedAt = new Date();
      complaint.resolvedByUserId = adminUserId;
      await manager.save(complaint);
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'complaint.resolved',
          entityType: 'complaint',
          entityId: complaint.id,
          oldValues: { complaint_status: previousStatus },
          newValues: {
            complaint_status: complaint.complaintStatus,
            resolution_type: complaint.resolutionType,
            compensation_cents: complaint.compensationCents,
          },
          meta,
        },
        manager,
      );
      return { complaint, previousStatus };
    });
    // بره الـtransaction عمداً (نفس فلسفة fileComplaint()) — docs/08 §73 بند 2
    this.events.emit(
      COMPLAINT_STATUS_CHANGED_EVENT,
      new ComplaintStatusChangedEvent(result.complaint.id, result.complaint.complaintNumber, result.complaint.filedByUserId, 'اتحلّت'),
    );
    return result.complaint;
  }

  async reject(
    adminUserId: string,
    complaintId: string,
    dto: RejectComplaintDto,
    meta?: AuditActorMeta,
  ): Promise<Complaint> {
    const result = await this.dataSource.transaction(async (manager) => {
      const complaint = await manager
        .createQueryBuilder(Complaint, 'complaint')
        .setLock('pessimistic_write')
        .where('complaint.id = :complaintId', { complaintId })
        .getOne();
      if (!complaint) {
        throw new ApiException(ErrorCode.VAL_001, 'الشكوى غير موجودة', HttpStatus.NOT_FOUND);
      }
      if (!canTransitionComplaint(complaint.complaintStatus, ComplaintStatus.REJECTED)) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `مينفعش ترفض شكوى في حالة ${complaint.complaintStatus}`,
          HttpStatus.CONFLICT,
        );
      }
      const previousStatus = complaint.complaintStatus;
      complaint.complaintStatus = ComplaintStatus.REJECTED;
      complaint.resolutionNotes = dto.resolution_notes;
      complaint.resolvedAt = new Date();
      complaint.resolvedByUserId = adminUserId;
      await manager.save(complaint);
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'complaint.rejected',
          entityType: 'complaint',
          entityId: complaint.id,
          oldValues: { complaint_status: previousStatus },
          newValues: {
            complaint_status: complaint.complaintStatus,
            resolution_notes: complaint.resolutionNotes,
          },
          meta,
        },
        manager,
      );
      return { complaint, previousStatus };
    });
    this.events.emit(
      COMPLAINT_STATUS_CHANGED_EVENT,
      new ComplaintStatusChangedEvent(result.complaint.id, result.complaint.complaintNumber, result.complaint.filedByUserId, 'اترفضت'),
    );
    return result.complaint;
  }

  async close(adminUserId: string, complaintId: string, meta?: AuditActorMeta): Promise<Complaint> {
    const complaint = await this.dataSource.transaction(async (manager) => {
      const complaint = await manager
        .createQueryBuilder(Complaint, 'complaint')
        .setLock('pessimistic_write')
        .where('complaint.id = :complaintId', { complaintId })
        .getOne();
      if (!complaint) {
        throw new ApiException(ErrorCode.VAL_001, 'الشكوى غير موجودة', HttpStatus.NOT_FOUND);
      }
      if (!canTransitionComplaint(complaint.complaintStatus, ComplaintStatus.CLOSED)) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `مينفعش تقفل شكوى في حالة ${complaint.complaintStatus} — لازم تتحل أو تترفض الأول`,
          HttpStatus.CONFLICT,
        );
      }
      const previousStatus = complaint.complaintStatus;
      complaint.complaintStatus = ComplaintStatus.CLOSED;
      await manager.save(complaint);
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'complaint.closed',
          entityType: 'complaint',
          entityId: complaint.id,
          oldValues: { complaint_status: previousStatus },
          newValues: { complaint_status: complaint.complaintStatus },
          meta,
        },
        manager,
      );
      return complaint;
    });
    this.events.emit(
      COMPLAINT_STATUS_CHANGED_EVENT,
      new ComplaintStatusChangedEvent(complaint.id, complaint.complaintNumber, complaint.filedByUserId, 'اتقفلت'),
    );
    return complaint;
  }

  /**
   * تعديل يدوي للتصنيف بعد المراجعة — التصنيف الأولي عند الفتح تلقائي حسب الفئة
   * (SEVERITY_BY_CATEGORY فوق)، بس القرار النهائي لسه لفريق الدعم زي ما كان موثّق دايماً.
   * بيعيد حساب slaDueAt من نفس لحظة التعديل (مش من وقت الفتح الأصلي) — لو شكوى اتصعّدت
   * لـ critical بعد ساعتين من فتحها، عندها 4 ساعات جديدة من دلوقتي مش من الأول.
   */
  async updateSeverity(
    adminUserId: string,
    complaintId: string,
    dto: UpdateComplaintSeverityDto,
    meta?: AuditActorMeta,
  ): Promise<Complaint> {
    return this.dataSource.transaction(async (manager) => {
      const complaint = await manager
        .createQueryBuilder(Complaint, 'complaint')
        .setLock('pessimistic_write')
        .where('complaint.id = :complaintId', { complaintId })
        .getOne();
      if (!complaint) {
        throw new ApiException(ErrorCode.VAL_001, 'الشكوى غير موجودة', HttpStatus.NOT_FOUND);
      }
      if (complaint.complaintStatus === ComplaintStatus.CLOSED) {
        throw new ApiException(ErrorCode.VAL_001, 'مينفعش تعدّل تصنيف شكوى مقفولة', HttpStatus.CONFLICT);
      }
      const previousSeverity = complaint.severity;
      if (previousSeverity === dto.severity) {
        throw new ApiException(ErrorCode.VAL_001, 'التصنيف ده نفس التصنيف الحالي أصلاً', HttpStatus.CONFLICT);
      }
      complaint.severity = dto.severity;
      complaint.slaDueAt = new Date(Date.now() + SLA_HOURS_BY_SEVERITY[dto.severity] * 60 * 60 * 1000);
      await manager.save(complaint);
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'complaint.severity_updated',
          entityType: 'complaint',
          entityId: complaint.id,
          oldValues: { severity: previousSeverity },
          newValues: { severity: complaint.severity, sla_due_at: complaint.slaDueAt.toISOString() },
          meta,
        },
        manager,
      );
      return complaint;
    });
  }

  private async resolveUserTypeOf(userId: string): Promise<UserType> {
    const isTechnician = await this.techniciansService.findByUserIdOrThrow(userId).catch(() => null);
    return isTechnician ? UserType.TECHNICIAN : UserType.CUSTOMER;
  }

  // نفس نمط OrderMediaService.upload تماماً — التخزين وراه نفس واجهة StorageService.
  async uploadAttachment(
    user: JwtPayload,
    complaintId: string,
    file: IncomingComplaintFile,
  ): Promise<ComplaintAttachment> {
    const complaint = await this.getForUser(user, complaintId);

    const key = `complaints/${complaint.id}/${randomUUID()}${safeExtensionForFile(file.buffer)}`;
    return uploadWithOrphanCleanup(this.storage, key, file.buffer, file.mimetype, async (fileUrl) => {
      const attachment = this.attachments.create({
        complaintId: complaint.id,
        fileUrl,
        storageKey: key,
        fileType: file.mimetype,
        uploadedByUserId: user.sub,
      });
      await this.attachments.save(attachment);
      return attachment;
    });
  }

  async listAttachments(user: JwtPayload, complaintId: string): Promise<ComplaintAttachment[]> {
    const complaint = await this.getForUser(user, complaintId);
    return this.attachments.find({ where: { complaintId: complaint.id }, order: { createdAt: 'ASC' } });
  }
}
