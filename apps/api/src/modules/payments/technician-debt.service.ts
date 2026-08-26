import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { SettingsService } from '../settings/settings.service';
import { TechniciansService } from '../technicians/technicians.service';
import { PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from './entities/wallet.entity';
import { WalletTxType } from './entities/wallet-transaction.entity';
import { DebtSettlementMethod, TechnicianDebtSettlement } from './entities/technician-debt-settlement.entity';
import { assessTechnicianDebt, DebtAssessment, DEFAULT_DEBT_POLICY } from './technician-debt-status';
import { WalletsService } from './wallets.service';

export interface TechnicianDebtView extends DebtAssessment {
  technicianId: string;
  balanceCents: number;
  debtSinceAt: string | null;
  settlements: {
    id: string;
    amountCents: number;
    method: DebtSettlementMethod;
    externalReference: string | null;
    note: string | null;
    recordedAt: string;
    balanceBeforeCents: number;
    balanceAfterCents: number;
  }[];
}

/**
 * مديونية الفني للمنصة (ADR-0041، docs/08 §63.أ2).
 *
 * **مفيش دفتر ديون موازي**: الرصيد يفضل في `wallets.balance_cents`، والخدمة دي بتقرا منه
 * وبتسجّل واقعة السداد بس.
 */
@Injectable()
export class TechnicianDebtService {
  private readonly logger = new Logger(TechnicianDebtService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly walletsService: WalletsService,
    private readonly techniciansService: TechniciansService,
    private readonly settingsService: SettingsService,
    private readonly auditLog: AuditLogService,
  ) {}

  private async policy() {
    return {
      alertThresholdCents: await this.settingsService.getNumber(
        'technician_debt.alert_threshold_cents',
        DEFAULT_DEBT_POLICY.alertThresholdCents,
      ),
      alertAgeDays: await this.settingsService.getNumber(
        'technician_debt.alert_age_days',
        DEFAULT_DEBT_POLICY.alertAgeDays,
      ),
    };
  }

  /**
   * أقدم لحظة الرصيد بقى فيها سالب ومرجعش موجب بعدها.
   *
   * بيتحسب من `wallet_transactions` — سجل **ممنوع عليه UPDATE/DELETE** على مستوى الداتابيز
   * (`0008_finance.sql`)، يعني مستحيل يتلاعب فيه. تخزين التاريخ ده في عمود كان هيحتاج تحديث مع
   * كل حركة ومزامنة تقدر تغلط؛ الحساب من سجل ثابت مستحيل يتعارض مع الرصيد.
   *
   * الطريقة: بنمشي بالعكس (من الأحدث للأقدم) بنفكّ أثر كل حركة على الرصيد. أول لحظة يبقى فيها
   * الرصيد التاريخي موجب (أو صفر) — الحركة اللي بعدها هي بداية الدَّين الحالي.
   */
  async resolveDebtSince(manager: EntityManager, walletId: string, currentBalanceCents: number): Promise<Date | null> {
    if (currentBalanceCents >= 0) return null;

    interface Row { created_at: Date; direction: string; amount_cents: number }
    const rows = await manager.query<Row[]>(
      `SELECT created_at, direction, amount_cents
         FROM wallet_transactions
        WHERE wallet_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 500`,
      [walletId],
    );

    let running = currentBalanceCents;
    let debtStart: Date | null = null;
    for (const row of rows) {
      // فكّ أثر الحركة: الرصيد قبلها = الرصيد بعدها ∓ المبلغ
      const before = row.direction === 'credit' ? running + row.amount_cents : running - row.amount_cents;
      if (running < 0) debtStart = row.created_at;
      if (before >= 0) return debtStart;
      running = before;
    }
    // الدَّين أقدم من آخر 500 حركة (أو المحفظة كلها سالبة من أولها) — بنرجّع أقدم ما شفناه.
    return debtStart;
  }

  async getDebtView(technicianProfileId: string): Promise<TechnicianDebtView> {
    const profile = await this.techniciansService.findByProfileIdOrThrow(technicianProfileId);
    const wallet = await this.walletsService.getOrCreateWallet(profile.userId, WalletOwnerType.TECHNICIAN);
    const debtSince = await this.resolveDebtSince(this.dataSource.manager, wallet.id, wallet.balanceCents);
    const assessment = assessTechnicianDebt(wallet.balanceCents, debtSince, await this.policy(), new Date());

    const settlements = await this.dataSource.getRepository(TechnicianDebtSettlement).find({
      where: { technicianId: technicianProfileId },
      order: { createdAt: 'DESC' },
      take: 50,
    });

    return {
      ...assessment,
      technicianId: technicianProfileId,
      balanceCents: wallet.balanceCents,
      debtSinceAt: debtSince?.toISOString() ?? null,
      settlements: settlements.map((s) => ({
        id: s.id,
        amountCents: s.amountCents,
        method: s.method,
        externalReference: s.externalReference,
        note: s.note,
        recordedAt: s.createdAt.toISOString(),
        balanceBeforeCents: s.balanceBeforeCents,
        balanceAfterCents: s.balanceAfterCents,
      })),
    };
  }

  /**
   * «الراجل ده دفع» — تسجيل سداد حصل برّه التطبيق.
   *
   * بيعمل قيد مزدوج حقيقي (منصة → الفني) عشان الرصيد يتحرّك من المسار الرسمي الوحيد، وبيسجّل
   * الواقعة بمبلغها وطريقتها ومرجعها. الاتنين جوّه **ترانزاكشن واحدة**: مينفعش نسجّل سداد
   * والرصيد ما اتحركش، ولا نحرّك رصيد بلا سجل يفسّره.
   */
  async recordSettlement(
    adminUserId: string,
    technicianProfileId: string,
    input: { amountCents: number; method: DebtSettlementMethod; externalReference?: string; note?: string },
    meta?: AuditActorMeta,
  ): Promise<TechnicianDebtView> {
    const profile = await this.techniciansService.findByProfileIdOrThrow(technicianProfileId);

    await this.dataSource.transaction(async (manager) => {
      const technicianWallet = await this.walletsService.getOrCreateWallet(
        profile.userId,
        WalletOwnerType.TECHNICIAN,
        manager,
      );
      const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);

      if (technicianWallet.balanceCents >= 0) {
        throw new ApiException(ErrorCode.VAL_001, 'الفني مش مديون للمنصة أصلاً', HttpStatus.CONFLICT);
      }
      const debtCents = -technicianWallet.balanceCents;
      if (input.amountCents > debtCents) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `المبلغ أكبر من المديونية الحالية (${debtCents / 100} ج.م.)`,
          HttpStatus.BAD_REQUEST,
        );
      }

      const { credit } = await this.walletsService.doubleEntry(
        {
          fromWalletId: platformWallet.id,
          toWalletId: technicianWallet.id,
          amountCents: input.amountCents,
          transactionType: WalletTxType.ADJUSTMENT,
          referenceType: 'technician_debt_settlement',
          referenceId: technicianProfileId,
          descriptionAr: `سداد مديونية — ${input.method === 'cash' ? 'كاش' : input.method === 'instapay' ? 'إنستاباي' : 'تحويل بنكي'}`,
          allowNegativeBalance: true, // محفظة المنصة تمثيل محاسبي، مش رصيد حقيقي محدود
        },
        manager,
      );

      await manager.getRepository(TechnicianDebtSettlement).insert({
        technicianId: technicianProfileId,
        amountCents: input.amountCents,
        method: input.method,
        externalReference: input.externalReference ?? null,
        note: input.note ?? null,
        balanceBeforeCents: technicianWallet.balanceCents,
        balanceAfterCents: technicianWallet.balanceCents + input.amountCents,
        recordedByUserId: adminUserId,
        walletTransactionId: credit.id,
      });
    });

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'technician.debt_settlement_recorded',
      entityType: 'technician_profile',
      entityId: technicianProfileId,
      newValues: {
        amount_cents: input.amountCents,
        method: input.method,
        external_reference: input.externalReference ?? null,
        note: input.note ?? null,
      },
      meta,
    });

    this.logger.log(`سداد مديونية للفني ${technicianProfileId}: ${input.amountCents} قرش (${input.method})`);
    return this.getDebtView(technicianProfileId);
  }

  /**
   * الفنيين المديونين — لشاشة متابعة واحدة بدل ما الأدمن يدوّر فني فني.
   *
   * استعلام واحد بيجيب الأرصدة السالبة، وبعدين بيتحسب عمر كل دَين. العدد المتوقع صغير (فنيين
   * مديونين، مش كل الفنيين)، فالحساب لكل صف مقبول هنا بعكس قايمة الطلبات.
   */
  async listTechniciansInDebt(): Promise<TechnicianDebtView[]> {
    interface Row { technician_id: string }
    const rows = await this.dataSource.query<Row[]>(
      `SELECT tp.id AS technician_id
         FROM wallets w
         JOIN technician_profiles tp ON tp.user_id = w.owner_user_id
        WHERE w.balance_cents < 0 AND w.deleted_at IS NULL AND tp.deleted_at IS NULL
        ORDER BY w.balance_cents ASC`,
    );
    return Promise.all(rows.map((r) => this.getDebtView(r.technician_id)));
  }
}
