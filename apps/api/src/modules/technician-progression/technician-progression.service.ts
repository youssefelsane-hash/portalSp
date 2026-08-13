import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TechnicianLevelChangeType, TechnicianLevelHistory } from '../technicians/entities/technician-level-history.entity';
import { TechnicianLevel, TechnicianVerificationStatus, TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianProgressionCalculationService } from './technician-progression-calculation.service';
import { TechnicianProgressionRule } from './entities/technician-progression-rule.entity';
import { TechnicianProgressionStatus } from './entities/technician-progression-status.entity';
import { UpdateProgressionRuleDto } from './dto/update-progression-rule.dto';

export interface ListProgressionStatusParams {
  isEligible?: boolean;
  needsDemotionReview?: boolean;
  page: number;
  perPage: number;
}

@Injectable()
export class TechnicianProgressionService {
  private readonly logger = new Logger(TechnicianProgressionService.name);

  constructor(
    @InjectRepository(TechnicianProgressionRule) private readonly rules: Repository<TechnicianProgressionRule>,
    @InjectRepository(TechnicianProgressionStatus) private readonly statuses: Repository<TechnicianProgressionStatus>,
    @InjectRepository(TechnicianProfile) private readonly technicianProfiles: Repository<TechnicianProfile>,
    @InjectRepository(TechnicianLevelHistory) private readonly levelHistory: Repository<TechnicianLevelHistory>,
    private readonly calculation: TechnicianProgressionCalculationService,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── إعدادات القواعد ──────────────────────────────────────────────
  listRules(): Promise<TechnicianProgressionRule[]> {
    return this.rules.find({ order: { fromLevel: 'ASC' } });
  }

  async updateRule(id: string, dto: UpdateProgressionRuleDto, adminUserId: string): Promise<TechnicianProgressionRule> {
    const rule = await this.rules.findOne({ where: { id } });
    if (!rule) {
      throw new ApiException(ErrorCode.VAL_001, 'قاعدة الترقية غير موجودة', HttpStatus.NOT_FOUND);
    }
    const oldValues = { ...rule };
    Object.assign(rule, {
      enabled: dto.enabled ?? rule.enabled,
      autoPromote: dto.auto_promote ?? rule.autoPromote,
      minCompletedOrders: dto.min_completed_orders ?? rule.minCompletedOrders,
      minPlatformRevenueCents: dto.min_platform_revenue_cents !== undefined ? String(dto.min_platform_revenue_cents) : rule.minPlatformRevenueCents,
      minAvgRating: dto.min_avg_rating !== undefined ? (dto.min_avg_rating === null ? null : String(dto.min_avg_rating)) : rule.minAvgRating,
      maxCancellationRate:
        dto.max_cancellation_rate !== undefined ? (dto.max_cancellation_rate === null ? null : String(dto.max_cancellation_rate)) : rule.maxCancellationRate,
      maxUpheldComplaints: dto.max_upheld_complaints !== undefined ? dto.max_upheld_complaints : rule.maxUpheldComplaints,
      minAvgKpiScore: dto.min_avg_kpi_score !== undefined ? (dto.min_avg_kpi_score === null ? null : String(dto.min_avg_kpi_score)) : rule.minAvgKpiScore,
      minKpiMonthsCount: dto.min_kpi_months_count ?? rule.minKpiMonthsCount,
      minDaysActive: dto.min_days_active ?? rule.minDaysActive,
      enableDemotionReview: dto.enable_demotion_review ?? rule.enableDemotionReview,
      demotionReviewMaxCancellationRate:
        dto.demotion_review_max_cancellation_rate !== undefined
          ? (dto.demotion_review_max_cancellation_rate === null ? null : String(dto.demotion_review_max_cancellation_rate))
          : rule.demotionReviewMaxCancellationRate,
      demotionReviewMinAvgRating:
        dto.demotion_review_min_avg_rating !== undefined
          ? (dto.demotion_review_min_avg_rating === null ? null : String(dto.demotion_review_min_avg_rating))
          : rule.demotionReviewMinAvgRating,
      demotionReviewMaxUpheldComplaints:
        dto.demotion_review_max_upheld_complaints !== undefined ? dto.demotion_review_max_upheld_complaints : rule.demotionReviewMaxUpheldComplaints,
    });
    await this.rules.save(rule);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'technician_progression_rule.updated',
      entityType: 'technician_progression_rule',
      entityId: rule.id,
      oldValues,
      newValues: { ...rule },
    });
    return rule;
  }

  // ── الحساب ──────────────────────────────────────────────────────
  async calculateAll(technicianId?: string): Promise<{ evaluated: number; autoPromoted: number }> {
    const qb = this.technicianProfiles
      .createQueryBuilder('tp')
      .where('tp.verificationStatus = :status', { status: TechnicianVerificationStatus.APPROVED });
    if (technicianId) qb.andWhere('tp.id = :id', { id: technicianId });
    const technicians = await qb.getMany();

    const allRules = await this.rules.find();
    const rulesByFromLevel = new Map(allRules.map((r) => [r.fromLevel, r]));

    let evaluated = 0;
    let autoPromoted = 0;

    for (const technician of technicians) {
      const rule = rulesByFromLevel.get(technician.currentLevel) ?? null;
      const metrics = await this.calculation.getRawMetrics(
        technician.id,
        technician.userId,
        technician.approvedAt,
        technician.createdAt,
        rule?.minKpiMonthsCount ?? 1,
      );
      const evaluation = this.calculation.evaluate(metrics, rule);

      let status = await this.statuses.findOne({ where: { technicianId: technician.id } });
      const wasEligible = status?.isEligible ?? false;

      if (!status) {
        status = this.statuses.create({ technicianId: technician.id });
      }
      status.currentLevel = technician.currentLevel;
      status.nextLevel = rule?.enabled ? rule.toLevel : null;
      status.isEligible = evaluation.isEligible;
      status.unmetRequirements = evaluation.unmetRequirements;
      status.progress = evaluation.progress;
      status.needsDemotionReview = evaluation.needsDemotionReview;
      status.demotionReviewReason = evaluation.demotionReviewReason;
      status.lastEvaluatedAt = new Date();
      if (evaluation.isEligible && !wasEligible) {
        status.eligibleSince = new Date();
      } else if (!evaluation.isEligible) {
        status.eligibleSince = null;
      }
      await this.statuses.save(status);
      evaluated += 1;

      if (evaluation.isEligible && rule?.autoPromote) {
        await this.executePromotion(technician, rule.toLevel, null, 'ترقية آلية — استوفى شروط الانتقال المفعّل عليه auto_promote', status);
        await this.statuses.save(status);
        autoPromoted += 1;
      }
    }

    this.logger.log(`Progression evaluation: ${evaluated} evaluated, ${autoPromoted} auto-promoted.`);
    return { evaluated, autoPromoted };
  }

  async getOrThrow(id: string): Promise<TechnicianProgressionStatus> {
    const status = await this.statuses.findOne({ where: { id } });
    if (!status) {
      throw new ApiException(ErrorCode.VAL_001, 'حالة الترقية غير موجودة', HttpStatus.NOT_FOUND);
    }
    return status;
  }

  async listForAdmin(params: ListProgressionStatusParams): Promise<{ items: TechnicianProgressionStatus[]; total: number }> {
    const qb = this.statuses.createQueryBuilder('s');
    if (params.isEligible !== undefined) qb.andWhere('s.isEligible = :e', { e: params.isEligible });
    if (params.needsDemotionReview !== undefined) qb.andWhere('s.needsDemotionReview = :d', { d: params.needsDemotionReview });
    qb.orderBy('s.isEligible', 'DESC').addOrderBy('s.lastEvaluatedAt', 'DESC');
    qb.skip((params.page - 1) * params.perPage).take(params.perPage);
    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  async getTechnicianSummary(
    technicianId: string,
  ): Promise<{ status: TechnicianProgressionStatus | null; history: TechnicianLevelHistory[] }> {
    const status = await this.statuses.findOne({ where: { technicianId } });
    const history = await this.levelHistory.find({ where: { technicianId }, order: { createdAt: 'DESC' }, take: 20 });
    return { status, history };
  }

  /** موافقة الأدمن على ترقية محسوبة كمؤهّلة بالفعل. */
  async approve(id: string, adminUserId: string, reason: string | null): Promise<TechnicianProgressionStatus> {
    const status = await this.getOrThrow(id);
    if (!status.isEligible || !status.nextLevel) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني مش مؤهّل آليًا للترقية دلوقتي — استخدم override لو قرار استثنائي', HttpStatus.CONFLICT);
    }
    const technician = await this.technicianProfiles.findOneOrFail({ where: { id: status.technicianId } });
    await this.executePromotion(technician, status.nextLevel, adminUserId, reason ?? 'اعتماد أدمن — استوفى شروط الترقية', status);
    status.adminDecision = 'approved';
    status.adminDecisionByUserId = adminUserId;
    status.adminDecisionAt = new Date();
    status.adminDecisionReason = reason;
    await this.statuses.save(status);
    return status;
  }

  /** ترقية استثنائية لفني مش مؤهّل آليًا — سبب إلزامي، صلاحية أعلى (technician_progression.override). */
  async override(id: string, adminUserId: string, reason: string): Promise<TechnicianProgressionStatus> {
    const status = await this.getOrThrow(id);
    if (!status.nextLevel) {
      throw new ApiException(ErrorCode.VAL_001, 'مفيش مستوى تالي معرّف للفني ده', HttpStatus.CONFLICT);
    }
    const technician = await this.technicianProfiles.findOneOrFail({ where: { id: status.technicianId } });
    await this.executePromotion(technician, status.nextLevel, adminUserId, reason, status, true);
    status.adminDecision = 'approved';
    status.adminDecisionByUserId = adminUserId;
    status.adminDecisionAt = new Date();
    status.adminDecisionReason = reason;
    await this.statuses.save(status);
    return status;
  }

  async reject(id: string, adminUserId: string, reason: string): Promise<TechnicianProgressionStatus> {
    const status = await this.getOrThrow(id);
    status.adminDecision = 'rejected';
    status.adminDecisionByUserId = adminUserId;
    status.adminDecisionAt = new Date();
    status.adminDecisionReason = reason;
    await this.statuses.save(status);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'technician_progression.rejected',
      entityType: 'technician_progression_status',
      entityId: status.id,
      newValues: { reason },
    });
    return status;
  }

  private async executePromotion(
    technician: TechnicianProfile,
    newLevel: TechnicianLevel,
    actorUserId: string | null,
    reason: string,
    status: TechnicianProgressionStatus,
    isOverride = false,
  ): Promise<void> {
    const previousLevel = technician.currentLevel;
    technician.currentLevel = newLevel;
    await this.technicianProfiles.save(technician);

    await this.levelHistory.save(
      this.levelHistory.create({
        technicianId: technician.id,
        previousLevel,
        newLevel,
        changeType: isOverride ? TechnicianLevelChangeType.MANUAL_OVERRIDE : TechnicianLevelChangeType.PROMOTION,
        qualityScoreAtChange: technician.qualityScore,
        reason,
        changedByUserId: actorUserId,
        effectiveFrom: new Date(),
      }),
    );

    const nextRule = await this.rules.findOne({ where: { fromLevel: newLevel } });
    status.currentLevel = newLevel;
    status.nextLevel = nextRule?.enabled ? nextRule.toLevel : null;
    status.isEligible = false;
    status.unmetRequirements = [];
    status.progress = {};
    status.eligibleSince = null;

    await this.auditLog.record({
      actorUserId,
      actorRole: actorUserId ? 'admin' : 'system',
      action: isOverride ? 'technician_progression.override_promoted' : 'technician_progression.promoted',
      entityType: 'technician_profile',
      entityId: technician.id,
      oldValues: { current_level: previousLevel },
      newValues: { current_level: newLevel, reason },
    });

    this.notifications
      .notify({
        userId: technician.userId,
        notificationType: 'technician_progression_promoted',
        titleAr: 'مبروك — ترقية جديدة!',
        bodyAr: `اتترقّيت من مستوى "${previousLevel}" لمستوى "${newLevel}"`,
        referenceType: 'technician_profile',
        referenceId: technician.id,
      })
      .catch((err) => this.logger.warn(`فشل إرسال إشعار ترقية: ${err.message}`));
  }
}
