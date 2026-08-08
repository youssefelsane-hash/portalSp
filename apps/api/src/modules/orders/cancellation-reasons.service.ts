import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { CreateCancellationReasonDto } from './dto/create-cancellation-reason.dto';
import { UpdateCancellationReasonDto } from './dto/update-cancellation-reason.dto';
import { CancellationAppliesTo, CancellationReason } from './entities/cancellation-reason.entity';

@Injectable()
export class CancellationReasonsService {
  constructor(
    @InjectRepository(CancellationReason) private readonly reasons: Repository<CancellationReason>,
    private readonly auditLog: AuditLogService,
  ) {}

  listActive(appliesTo?: CancellationAppliesTo): Promise<CancellationReason[]> {
    return this.reasons.find({
      where: { isActive: true, ...(appliesTo ? { appliesTo } : {}) },
      order: { displayOrder: 'ASC' },
    });
  }

  listAllForAdmin(): Promise<CancellationReason[]> {
    return this.reasons.find({ order: { displayOrder: 'ASC' } });
  }

  async findOrThrow(id: string): Promise<CancellationReason> {
    const reason = await this.reasons.findOne({ where: { id } });
    if (!reason) {
      throw new ApiException(ErrorCode.VAL_001, 'سبب الإلغاء غير موجود', HttpStatus.NOT_FOUND);
    }
    return reason;
  }

  async create(adminUserId: string, dto: CreateCancellationReasonDto, meta?: AuditActorMeta): Promise<CancellationReason> {
    const reason = this.reasons.create({
      reasonAr: dto.reason_ar,
      reasonEn: dto.reason_en,
      appliesTo: dto.applies_to,
      chargesFee: dto.charges_fee ?? false,
      feePercentage: dto.fee_percentage !== undefined ? String(dto.fee_percentage) : '0',
      affectsTechnicianScore: dto.affects_technician_score ?? false,
      displayOrder: dto.display_order ?? 0,
    });
    await this.reasons.save(reason);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'cancellation_reason.created',
      entityType: 'cancellation_reason',
      entityId: reason.id,
      newValues: { reason_ar: reason.reasonAr, applies_to: reason.appliesTo },
      meta,
    });
    return reason;
  }

  async update(
    adminUserId: string,
    id: string,
    dto: UpdateCancellationReasonDto,
    meta?: AuditActorMeta,
  ): Promise<CancellationReason> {
    const reason = await this.findOrThrow(id);
    const oldValues = { charges_fee: reason.chargesFee, fee_percentage: reason.feePercentage, is_active: reason.isActive };

    if (dto.reason_ar !== undefined) reason.reasonAr = dto.reason_ar;
    if (dto.reason_en !== undefined) reason.reasonEn = dto.reason_en;
    if (dto.applies_to !== undefined) reason.appliesTo = dto.applies_to;
    if (dto.charges_fee !== undefined) reason.chargesFee = dto.charges_fee;
    if (dto.fee_percentage !== undefined) reason.feePercentage = String(dto.fee_percentage);
    if (dto.affects_technician_score !== undefined) reason.affectsTechnicianScore = dto.affects_technician_score;
    if (dto.display_order !== undefined) reason.displayOrder = dto.display_order;
    if (dto.is_active !== undefined) reason.isActive = dto.is_active;
    await this.reasons.save(reason);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'cancellation_reason.updated',
      entityType: 'cancellation_reason',
      entityId: reason.id,
      oldValues,
      newValues: { charges_fee: reason.chargesFee, fee_percentage: reason.feePercentage, is_active: reason.isActive },
      meta,
    });
    return reason;
  }
}
