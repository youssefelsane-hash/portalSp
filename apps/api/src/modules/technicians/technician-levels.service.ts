import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { UpdateTechnicianLevelConfigDto } from './dto/update-technician-level-config.dto';
import { TechnicianLevelConfig } from './entities/technician-level-config.entity';
import { TechnicianLevel } from './entities/technician-profile.entity';

// المصدر الحقيقي الوحيد لسياسة كل مستوى فني — عمولة، أولوية إرسال، حد قرار، وأهلية قيادة فريق.
// أي موديول محتاج القيم دي (payments, matching, technicians) بيقرا من هنا مباشرة، مفيش ثوابت مكتوبة في الكود.
@Injectable()
export class TechnicianLevelsService {
  constructor(
    @InjectRepository(TechnicianLevelConfig) private readonly configs: Repository<TechnicianLevelConfig>,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(): Promise<TechnicianLevelConfig[]> {
    return this.configs.find({ order: { orderPriorityWeight: 'ASC' } });
  }

  async getOrThrow(level: TechnicianLevel): Promise<TechnicianLevelConfig> {
    const config = await this.configs.findOne({ where: { level } });
    if (!config) {
      // ميقدرش يحصل عملياً — الـ 5 مستويات مزروعة كلها في 0028، دفاعي بس
      throw new ApiException(ErrorCode.VAL_001, 'إعدادات المستوى ده غير موجودة', HttpStatus.NOT_FOUND);
    }
    return config;
  }

  async update(
    adminUserId: string,
    level: TechnicianLevel,
    dto: UpdateTechnicianLevelConfigDto,
    meta?: AuditActorMeta,
  ): Promise<TechnicianLevelConfig> {
    const config = await this.getOrThrow(level);
    const oldValues = {
      display_name_ar: config.displayNameAr,
      commission_adjustment_percentage: Number(config.commissionAdjustmentPercentage),
      order_priority_weight: config.orderPriorityWeight,
      assistant_earning_multiplier: Number(config.assistantEarningMultiplier),
      decision_limit_cents: config.decisionLimitCents,
      can_lead_team: config.canLeadTeam,
      eligible_for_team_booking: config.eligibleForTeamBooking,
    };

    if (dto.display_name_ar !== undefined) config.displayNameAr = dto.display_name_ar;
    if (dto.commission_adjustment_percentage !== undefined) config.commissionAdjustmentPercentage = String(dto.commission_adjustment_percentage);
    if (dto.order_priority_weight !== undefined) config.orderPriorityWeight = dto.order_priority_weight;
    if (dto.assistant_earning_multiplier !== undefined) {
      config.assistantEarningMultiplier = String(dto.assistant_earning_multiplier);
    }
    if (dto.decision_limit_cents !== undefined) config.decisionLimitCents = dto.decision_limit_cents;
    if (dto.can_lead_team !== undefined) config.canLeadTeam = dto.can_lead_team;
    if (dto.eligible_for_team_booking !== undefined) config.eligibleForTeamBooking = dto.eligible_for_team_booking;
    await this.configs.save(config);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'technician_level_config.updated',
      entityType: 'technician_level_config',
      entityId: config.id,
      oldValues,
      newValues: {
        display_name_ar: config.displayNameAr,
        commission_adjustment_percentage: Number(config.commissionAdjustmentPercentage),
        order_priority_weight: config.orderPriorityWeight,
        assistant_earning_multiplier: Number(config.assistantEarningMultiplier),
        decision_limit_cents: config.decisionLimitCents,
        can_lead_team: config.canLeadTeam,
        eligible_for_team_booking: config.eligibleForTeamBooking,
      },
      meta,
    });
    return config;
  }
}
