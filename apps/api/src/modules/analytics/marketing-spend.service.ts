import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { UpsertMarketingSpendDto } from './dto/marketing-spend.dto';
import { MarketingSpend } from './entities/marketing-spend.entity';

@Injectable()
export class MarketingSpendService {
  constructor(
    @InjectRepository(MarketingSpend) private readonly spend: Repository<MarketingSpend>,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * الشهر بيتطبّع لأول يوم فيه (ADR-0081 §6). القيد في القاعدة بيرفض أي تاريخ تاني، فالتطبيع
   * هنا بيمنع خطأ 500 على الأدمن اللي بعت «2026-09-14» وهو قاصد شهر ٩.
   */
  private normalizeMonth(month: string): string {
    const parsed = new Date(`${month}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new ApiException(ErrorCode.VAL_001, 'صيغة الشهر غير صحيحة', HttpStatus.BAD_REQUEST);
    }
    return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }

  list(): Promise<MarketingSpend[]> {
    return this.spend.find({ where: { deletedAt: IsNull() }, order: { month: 'DESC', channel: 'ASC' } });
  }

  /**
   * إدخال أو تعديل إنفاق شهر/قناة. **upsert مش insert**: الأدمن اللي بيصحّح رقم الشهر ده
   * لازم يستبدله، مش يضيف صف تاني يتجمع عليه فيبقى الإنفاق ضعف الحقيقة.
   */
  async upsert(adminUserId: string, dto: UpsertMarketingSpendDto, meta?: AuditActorMeta): Promise<MarketingSpend> {
    const month = this.normalizeMonth(dto.month);
    const existing = await this.spend.findOne({ where: { month, channel: dto.channel, deletedAt: IsNull() } });

    const before = existing ? { amount_cents: existing.amountCents } : null;
    const row =
      existing ??
      this.spend.create({ month, channel: dto.channel, recordedByUserId: adminUserId });
    row.amountCents = dto.amount_cents;
    row.notes = dto.notes ?? null;
    row.recordedByUserId = adminUserId;
    await this.spend.save(row);

    // إنفاق التسويق مدخل بشري بيدخل في حساب CAC — أي تعديل عليه لازم يبان مين عمله.
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: existing ? 'marketing_spend.updated' : 'marketing_spend.created',
      entityType: 'marketing_spend',
      entityId: row.id,
      oldValues: before,
      newValues: { month, channel: row.channel, amount_cents: row.amountCents },
      meta,
    });
    return row;
  }

  async remove(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<void> {
    const row = await this.spend.findOne({ where: { id, deletedAt: IsNull() } });
    if (!row) {
      throw new ApiException(ErrorCode.VAL_001, 'سجل الإنفاق غير موجود', HttpStatus.NOT_FOUND);
    }
    await this.spend.softDelete(id);
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'marketing_spend.deleted',
      entityType: 'marketing_spend',
      entityId: id,
      oldValues: { month: row.month, channel: row.channel, amount_cents: row.amountCents },
      meta,
    });
  }
}
