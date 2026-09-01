import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../admin/permissions.service';
import { PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from '../payments/entities/wallet.entity';
import { WalletTxType } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { SettingsService } from '../settings/settings.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianKpiCalculationService } from './technician-kpi-calculation.service';
import { KpiSnapshotStatus, TechnicianKpiSnapshot } from './entities/technician-kpi-snapshot.entity';

export interface ListKpiSnapshotsParams {
  periodYear?: number;
  periodMonth?: number;
  technicianId?: string;
  status?: KpiSnapshotStatus;
  page: number;
  perPage: number;
}

@Injectable()
export class TechnicianKpiService {
  private readonly logger = new Logger(TechnicianKpiService.name);

  constructor(
    @InjectRepository(TechnicianKpiSnapshot) private readonly snapshots: Repository<TechnicianKpiSnapshot>,
    @InjectRepository(TechnicianProfile) private readonly technicianProfiles: Repository<TechnicianProfile>,
    private readonly calculation: TechnicianKpiCalculationService,
    private readonly settings: SettingsService,
    private readonly permissions: PermissionsService,
    private readonly wallets: WalletsService,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * بيحسب/يعيد حساب سنابشوت الشهر لكل الفنيين النشطين (أو فني واحد لو اتحدد). محمي بقاعدة
   * immutability: أي سنابشوت وصل approved/paid بيتقفل تمامًا — إعادة الحساب بترجع رمز 409 بدله
   * من غير ما تلمسه، عشان "بيانات لاحقة متغيّرة ميعدلش شهور تاريخية اتقفلت فعلاً".
   */
  async calculateForPeriod(
    periodYear: number,
    periodMonth: number,
    technicianId?: string,
  ): Promise<{ calculated: number; skippedLocked: number }> {
    const enabled = await this.settings.getBoolean('kpi.enabled', true);
    if (!enabled) {
      throw new ApiException(ErrorCode.VAL_001, 'محرك الـKPI الشهري متعطّل من الإعدادات', HttpStatus.BAD_REQUEST);
    }

    const technicianIds = technicianId
      ? [technicianId]
      : await this.calculation.listActiveTechnicianIds(periodYear, periodMonth);

    const platformAverageEarningsCents = await this.calculation.getPlatformAverageEarningsCents(
      periodYear,
      periodMonth,
    );

    let calculated = 0;
    let skippedLocked = 0;

    for (const techId of technicianIds) {
      const technician = await this.technicianProfiles.findOne({ where: { id: techId } });
      if (!technician) continue;

      const existing = await this.snapshots.findOne({
        where: { technicianId: techId, periodYear, periodMonth },
      });
      if (existing && (existing.status === KpiSnapshotStatus.APPROVED || existing.status === KpiSnapshotStatus.PAID)) {
        skippedLocked += 1;
        continue;
      }

      const metrics = await this.calculation.getRawMetrics(techId, technician.userId, periodYear, periodMonth);
      const scoreResult = await this.calculation.score(metrics, platformAverageEarningsCents);

      const payload = {
        technicianId: techId,
        periodYear,
        periodMonth,
        offeredOrdersCount: metrics.offeredOrdersCount,
        acceptedOrdersCount: metrics.acceptedOrdersCount,
        completedOrdersCount: metrics.completedOrdersCount,
        technicianCancelledCount: metrics.technicianCancelledCount,
        acceptanceRate:
          metrics.offeredOrdersCount > 0
            ? String(((metrics.acceptedOrdersCount / metrics.offeredOrdersCount) * 100).toFixed(2))
            : null,
        completionRate:
          metrics.acceptedOrdersCount > 0
            ? String(((metrics.completedOrdersCount / metrics.acceptedOrdersCount) * 100).toFixed(2))
            : null,
        cancellationRate:
          metrics.acceptedOrdersCount > 0
            ? String(((metrics.technicianCancelledCount / metrics.acceptedOrdersCount) * 100).toFixed(2))
            : null,
        averageRating: metrics.averageRating === null ? null : String(metrics.averageRating.toFixed(2)),
        ratingsCount: metrics.ratingsCount,
        negativeRatingsCount: metrics.negativeRatingsCount,
        averageCleanlinessRating:
          metrics.averageCleanlinessRating === null ? null : String(metrics.averageCleanlinessRating.toFixed(2)),
        complaintsCount: metrics.complaintsCount,
        complaintsUpheldCount: metrics.complaintsUpheldCount,
        seriousUpheldComplaint: metrics.seriousUpheldComplaint,
        revisitCount: metrics.revisitCount,
        platformRevenueCents: String(metrics.platformRevenueCents),
        technicianEarningsCents: String(metrics.technicianEarningsCents),
        orderValueCents: String(metrics.orderValueCents),
        isEligible: scoreResult.isEligible,
        ineligibilityReason: scoreResult.ineligibilityReason,
        dimensionScores: scoreResult.dimensionScores,
        weightsApplied: scoreResult.weightsApplied,
        overallScore: scoreResult.overallScore === null ? null : String(scoreResult.overallScore.toFixed(2)),
        suggestedBonusCents: scoreResult.suggestedBonusCents,
        calculatedAt: new Date(),
      };

      if (existing) {
        await this.snapshots.update(existing.id, payload);
      } else {
        await this.snapshots.save(this.snapshots.create(payload));
      }
      calculated += 1;
    }

    this.logger.log(
      `KPI calculation for ${periodYear}-${periodMonth}: ${calculated} calculated, ${skippedLocked} locked (already approved/paid).`,
    );
    return { calculated, skippedLocked };
  }

  async getOrThrow(id: string): Promise<TechnicianKpiSnapshot> {
    const snapshot = await this.snapshots.findOne({ where: { id } });
    if (!snapshot) {
      throw new ApiException(ErrorCode.VAL_001, 'سنابشوت الـKPI غير موجود', HttpStatus.NOT_FOUND);
    }
    return snapshot;
  }

  async listForAdmin(
    params: ListKpiSnapshotsParams,
  ): Promise<{ items: TechnicianKpiSnapshot[]; total: number }> {
    const qb = this.snapshots.createQueryBuilder('s');
    if (params.periodYear) qb.andWhere('s.periodYear = :y', { y: params.periodYear });
    if (params.periodMonth) qb.andWhere('s.periodMonth = :m', { m: params.periodMonth });
    if (params.technicianId) qb.andWhere('s.technicianId = :t', { t: params.technicianId });
    if (params.status) qb.andWhere('s.status = :st', { st: params.status });
    qb.orderBy('s.overallScore', 'DESC', 'NULLS LAST').addOrderBy('s.createdAt', 'DESC');
    qb.skip((params.page - 1) * params.perPage).take(params.perPage);
    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  async getTechnicianSummary(
    technicianId: string,
    visibleOnly = false,
  ): Promise<{ latest: TechnicianKpiSnapshot | null; history: TechnicianKpiSnapshot[] }> {
    const history = await this.snapshots.find({
      where: visibleOnly
        ? {
            technicianId,
            status: In([KpiSnapshotStatus.APPROVED, KpiSnapshotStatus.PAID, KpiSnapshotStatus.REJECTED]),
          }
        : { technicianId },
      order: { periodYear: 'DESC', periodMonth: 'DESC' },
      take: 12,
    });
    return { latest: history[0] ?? null, history };
  }

  /**
   * موافقة الأدمن على مبلغ نهائي — مش لازم يساوي المقترح (لو kpi.ops_can_override_suggested_amount
   * مفعّلة، الافتراضي). السقف الشهري (kpi.monthly_max_bonus_cents) بيتفرض دايمًا إلا لو الأدمن
   * عنده technician_kpi.override_max — نفس نمط roles.grant_unrestricted بالظبط.
   */
  async approve(
    id: string,
    approvedByUserId: string,
    approvedBonusCents: number,
    notes: string | null,
  ): Promise<TechnicianKpiSnapshot> {
    const snapshot = await this.getOrThrow(id);
    if (snapshot.status === KpiSnapshotStatus.APPROVED || snapshot.status === KpiSnapshotStatus.PAID) {
      throw new ApiException(ErrorCode.VAL_001, 'السنابشوت ده اتوافق عليه بالفعل', HttpStatus.CONFLICT);
    }
    if (approvedBonusCents < 0) {
      throw new ApiException(ErrorCode.VAL_001, 'المبلغ لازم يكون صفر أو أكبر', HttpStatus.BAD_REQUEST);
    }

    const [monthlyMax, opsCanOverride] = await Promise.all([
      this.settings.getNumber('kpi.monthly_max_bonus_cents', 500000),
      this.settings.getBoolean('kpi.ops_can_override_suggested_amount', true),
    ]);

    const hasOverride = await this.permissions.hasPermission(approvedByUserId, 'technician_kpi.override_max');

    if (approvedBonusCents > monthlyMax && !hasOverride) {
      throw new ApiException(
        ErrorCode.AUTH_001,
        `المبلغ (${approvedBonusCents}) أكبر من السقف الشهري المسموح (${monthlyMax}) — محتاج صلاحية technician_kpi.override_max`,
        HttpStatus.FORBIDDEN,
      );
    }

    // شكوى حرجة صفّرت الدرجة — اعتماد مبلغ فوق صفر هنا استثناء واعي، يحتاج نفس صلاحية التجاوز.
    if (snapshot.seriousUpheldComplaint && approvedBonusCents > 0 && !hasOverride) {
      throw new ApiException(
        ErrorCode.AUTH_001,
        'الشهر ده فيه شكوى حرجة مثبتة صفّرت الـKPI — اعتماد مكافأة فوق صفر محتاج صلاحية technician_kpi.override_max',
        HttpStatus.FORBIDDEN,
      );
    }

    if (
      !opsCanOverride &&
      snapshot.suggestedBonusCents !== null &&
      approvedBonusCents !== snapshot.suggestedBonusCents
    ) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'الإعدادات الحالية مايسمحوش بتعديل المبلغ المقترح — لازم يتساوى بالظبط',
        HttpStatus.BAD_REQUEST,
      );
    }

    const oldValues = { status: snapshot.status, approved_bonus_cents: snapshot.approvedBonusCents };
    snapshot.status = KpiSnapshotStatus.APPROVED;
    snapshot.approvedBonusCents = approvedBonusCents;
    snapshot.approvedByUserId = approvedByUserId;
    snapshot.approvedAt = new Date();
    snapshot.approvalNotes = notes;
    await this.snapshots.save(snapshot);

    await this.auditLog.record({
      actorUserId: approvedByUserId,
      actorRole: 'admin',
      action: 'technician_kpi.approved',
      entityType: 'technician_kpi_snapshot',
      entityId: snapshot.id,
      oldValues,
      newValues: { status: snapshot.status, approved_bonus_cents: approvedBonusCents },
    });

    return snapshot;
  }

  async reject(id: string, rejectedByUserId: string, reason: string): Promise<TechnicianKpiSnapshot> {
    const snapshot = await this.getOrThrow(id);
    if (snapshot.status === KpiSnapshotStatus.APPROVED || snapshot.status === KpiSnapshotStatus.PAID) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش ترفض سنابشوت اتوافق عليه/اتصرف بالفعل', HttpStatus.CONFLICT);
    }
    const oldValues = { status: snapshot.status };
    snapshot.status = KpiSnapshotStatus.REJECTED;
    snapshot.rejectedReason = reason;
    await this.snapshots.save(snapshot);

    await this.auditLog.record({
      actorUserId: rejectedByUserId,
      actorRole: 'admin',
      action: 'technician_kpi.rejected',
      entityType: 'technician_kpi_snapshot',
      entityId: snapshot.id,
      oldValues,
      newValues: { status: snapshot.status, reason },
    });

    return snapshot;
  }

  /** صرف المكافأة المعتمدة فعليًا عبر نظام المحفظة — idempotent (status='approved' بس قابل للصرف). */
  async pay(id: string, paidByUserId: string): Promise<TechnicianKpiSnapshot> {
    const snapshot = await this.getOrThrow(id);
    if (snapshot.status !== KpiSnapshotStatus.APPROVED) {
      throw new ApiException(ErrorCode.VAL_001, 'لازم يتوافق على السنابشوت الأول قبل الصرف', HttpStatus.CONFLICT);
    }
    if (!snapshot.approvedBonusCents || snapshot.approvedBonusCents <= 0) {
      throw new ApiException(ErrorCode.VAL_001, 'المبلغ المعتمد صفر — مفيش حاجة تُصرف', HttpStatus.BAD_REQUEST);
    }

    const technician = await this.technicianProfiles.findOne({ where: { id: snapshot.technicianId } });
    if (!technician) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني غير موجود', HttpStatus.NOT_FOUND);
    }

    const platformWallet = await this.wallets.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
    const technicianWallet = await this.wallets.getOrCreateWallet(technician.userId, WalletOwnerType.TECHNICIAN);

    const { credit } = await this.wallets.doubleEntry({
      fromWalletId: platformWallet.id,
      toWalletId: technicianWallet.id,
      amountCents: snapshot.approvedBonusCents,
      transactionType: WalletTxType.BONUS,
      referenceType: 'technician_kpi_snapshot',
      referenceId: snapshot.id,
      descriptionAr: `مكافأة أداء KPI — ${snapshot.periodMonth}/${snapshot.periodYear}`,
      performedByUserId: paidByUserId,
      allowNegativeBalance: true,
    });

    snapshot.status = KpiSnapshotStatus.PAID;
    snapshot.paidAt = new Date();
    snapshot.walletCreditTxId = credit.id;
    await this.snapshots.save(snapshot);

    await this.auditLog.record({
      actorUserId: paidByUserId,
      actorRole: 'admin',
      action: 'technician_kpi.paid',
      entityType: 'technician_kpi_snapshot',
      entityId: snapshot.id,
      newValues: { amount_cents: snapshot.approvedBonusCents, wallet_credit_tx_id: credit.id },
    });

    this.notifications
      .notify({
        userId: technician.userId,
        notificationType: 'technician_kpi_bonus_paid',
        titleAr: 'مكافأة أداء شهرية',
        bodyAr: `اتصرفت مكافأة أداء بقيمة ${(snapshot.approvedBonusCents / 100).toFixed(0)} ج.م. عن ${snapshot.periodMonth}/${snapshot.periodYear}`,
        referenceType: 'technician_kpi_snapshot',
        referenceId: snapshot.id,
      })
      .catch((err) => this.logger.warn(`فشل إرسال إشعار مكافأة KPI: ${err.message}`));

    return snapshot;
  }
}
