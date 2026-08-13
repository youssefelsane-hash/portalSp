import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditLogService } from '../audit/audit-log.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { UserDevice } from '../notifications/entities/user-device.entity';
import { Order } from '../orders/entities/order.entity';
import { PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from '../payments/entities/wallet.entity';
import { WalletTransaction, WalletTxType } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { SettingsService } from '../settings/settings.service';
import { TechnicianProfile, TechnicianVerificationStatus } from '../technicians/entities/technician-profile.entity';
import { TechnicianReferralAttribution } from './entities/technician-referral-attribution.entity';
import { TechnicianReferralBonus, TechnicianReferralBonusStatus } from './entities/technician-referral-bonus.entity';

type QualifyingStatus = 'accepted' | 'work_completed' | 'completed';
type RewardMode = 'first_order_only' | 'every_order';

export interface TechnicianReferralSummary {
  referralToken: string;
  attributedCustomersCount: number;
  qualifyingOrdersCount: number;
  totalCreditedCents: number;
  totalRevokedCents: number;
  totalRejectedCents: number;
  recentBonuses: TechnicianReferralBonus[];
}

@Injectable()
export class TechnicianReferralsService {
  private readonly logger = new Logger(TechnicianReferralsService.name);

  constructor(
    @InjectRepository(TechnicianReferralAttribution)
    private readonly attributions: Repository<TechnicianReferralAttribution>,
    @InjectRepository(TechnicianReferralBonus) private readonly bonuses: Repository<TechnicianReferralBonus>,
    @InjectRepository(TechnicianProfile) private readonly technicianProfiles: Repository<TechnicianProfile>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(CustomerProfile) private readonly customerProfiles: Repository<CustomerProfile>,
    @InjectRepository(UserDevice) private readonly userDevices: Repository<UserDevice>,
    @InjectRepository(WalletTransaction) private readonly walletTransactions: Repository<WalletTransaction>,
    private readonly settingsService: SettingsService,
    private readonly walletsService: WalletsService,
    private readonly auditLog: AuditLogService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async findTechnicianByToken(token: string): Promise<TechnicianProfile> {
    const technician = await this.technicianProfiles.findOne({ where: { technicianCode: token } });
    if (!technician || technician.verificationStatus !== TechnicianVerificationStatus.APPROVED) {
      throw new ApiException(ErrorCode.VAL_001, 'كود الترشيح غير صحيح', HttpStatus.BAD_REQUEST);
    }
    return technician;
  }

  /** بتتنادى من TechnicianReferralCapturedListener بعد تسجيل عميل جديد بكود ترشيح فني. */
  async captureAtRegistration(customerUserId: string, referralToken: string): Promise<void> {
    try {
      const technician = await this.findTechnicianByToken(referralToken);
      if (technician.userId === customerUserId) return; // ترشيح ذاتي — تجاهل بصمت، مستحيل أصلاً لعميل جديد
      await this.attributions.insert({
        technicianId: technician.id,
        customerUserId,
        referralToken,
        attributedAt: new Date(),
      });
    } catch (err) {
      // فشل الالتقاط مايكسرش التسجيل نفسه — العميل سجّل بنجاح بغض النظر
      this.logger.error(`فشل التقاط ترشيح الفني وقت التسجيل لعميل ${customerUserId}`, err instanceof Error ? err.stack : err);
    }
  }

  /** عميل موجود بالفعل بيستخدم كود ترشيح فني (مسح QR بعد التسجيل) — POST /me/technician-referral. */
  async attributeExistingCustomer(customerUserId: string, referralToken: string): Promise<TechnicianReferralAttribution> {
    const technician = await this.findTechnicianByToken(referralToken);
    if (technician.userId === customerUserId) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش ترشّح نفسك', HttpStatus.BAD_REQUEST);
    }
    const existing = await this.attributions.findOne({ where: { customerUserId } });
    if (existing) {
      throw new ApiException(ErrorCode.VAL_001, 'عندك فني ترشيح متسجّل بالفعل — أول ترشيح بيفضل هو الساري', HttpStatus.CONFLICT);
    }
    const attribution = await this.attributions.save(
      this.attributions.create({ technicianId: technician.id, customerUserId, referralToken, attributedAt: new Date() }),
    );
    return attribution;
  }

  private rankOf(status: QualifyingStatus): number {
    return { accepted: 1, work_completed: 2, completed: 3 }[status];
  }

  /** بتتنادى من TechnicianReferralOrderStatusListener على أي ORDER_STATUS_CHANGED_EVENT. */
  async evaluateOrderForBonus(orderId: string, newStatus: string): Promise<void> {
    if (!(await this.settingsService.getBoolean('referral_qr.enabled', true))) return;

    const minStatus = (await this.settingsService.getString('referral_qr.qualifying_min_order_status', 'completed')) as QualifyingStatus;
    if (!['accepted', 'work_completed', 'completed'].includes(newStatus)) return;
    if (this.rankOf(newStatus as QualifyingStatus) < this.rankOf(minStatus)) return;

    // idempotency: order_id UNIQUE على الجدول — لو اتعالج قبل كده (أي انتقال حالة تاني وصل
    // للعتبة أو أعلى منها) منعمل حاجة تاني.
    const existingBonus = await this.bonuses.findOne({ where: { orderId } });
    if (existingBonus) return;

    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) return;
    const customerProfile = await this.customerProfiles.findOne({ where: { id: order.customerId } });
    if (!customerProfile) return;

    const attribution = await this.attributions.findOne({ where: { customerUserId: customerProfile.userId } });
    if (!attribution) return; // العميل ده مش عميل ترشيح فني أصلاً

    const rewardMode = (await this.settingsService.getString('referral_qr.reward_mode', 'first_order_only')) as RewardMode;
    if (rewardMode === 'first_order_only') {
      const priorCredited = await this.bonuses.count({
        where: { technicianId: attribution.technicianId, customerUserId: customerProfile.userId, status: TechnicianReferralBonusStatus.CREDITED },
      });
      if (priorCredited > 0) return; // أول طلب مؤهّل اتكافأ عليه الفني بالفعل
    }

    const minOrderAmount = await this.settingsService.getNumber('referral_qr.min_order_amount_cents', 0);
    if (minOrderAmount > 0 && order.totalAmountCents < minOrderAmount) return;

    const bonusAmount = await this.settingsService.getNumber('referral_qr.bonus_amount_cents', 5000);

    // ── فحوصات مضادة لإساءة الاستخدام — بترفض المكافأة (rejected_suspicious) مش الطلب نفسه ──
    let rejectionReason: string | null = null;
    const customerDevice = await this.userDevices.findOne({ where: { userId: customerProfile.userId, isActive: true } });

    const rejectDuplicateDevice = await this.settingsService.getBoolean('referral_qr.reject_duplicate_device', true);
    if (rejectDuplicateDevice && customerDevice) {
      // مقارنة بلقطات مخزّنة على مكافآت سابقة لنفس الفني، مش استعلام حي على user_devices —
      // device_id عمود UNIQUE عالميًا هناك (ملكية الجهاز بتتنقل بين المستخدمين، مش سجل تاريخي)،
      // فمقارنة حية كانت هتفشل تكتشف أي حاجة دايمًا (بَقّة حقيقية اتلقطت وقت الاختبار الحي: فني
      // سجّل جهاز، عميل جديد سجّل نفس الـdevice_id، الملكية اتنقلت بصمت للعميل فالمقارنة الحية
      // رجعت "مفيش تطابق" رغم إنه نفس الجهاز بالظبط). اللقطة الدائمة على صف المكافأة نفسه هي
      // اللي بتخلي الاكتشاف ممكن حتى بعد ما الجهاز يتنقل لمستخدم تالت أو رابع.
      const priorBonusFromSameDevice = await this.bonuses.findOne({
        where: { technicianId: attribution.technicianId, customerDeviceId: customerDevice.deviceId },
      });
      if (priorBonusFromSameDevice && priorBonusFromSameDevice.customerUserId !== customerProfile.userId) {
        rejectionReason = 'نفس الجهاز استُخدم قبل كده لعميل مختلف اتكافأ عليه الفني ده — احتمال حسابات وهمية';
      } else {
        const technician = await this.technicianProfiles.findOne({ where: { id: attribution.technicianId } });
        if (technician) {
          const technicianDevice = await this.userDevices.findOne({ where: { userId: technician.userId, isActive: true } });
          if (technicianDevice && technicianDevice.deviceId === customerDevice.deviceId) {
            rejectionReason = 'نفس جهاز الفني حاليًا — احتمال ترشيح ذاتي بحساب عميل وهمي';
          }
        }
      }
    }

    const cooldownMinutes = await this.settingsService.getNumber('referral_qr.min_minutes_between_bonuses', 0);
    if (cooldownMinutes > 0 && !rejectionReason) {
      const lastCredited = await this.bonuses.findOne({
        where: { technicianId: attribution.technicianId, status: TechnicianReferralBonusStatus.CREDITED },
        order: { creditedAt: 'DESC' },
      });
      if (lastCredited?.creditedAt) {
        const minutesSince = (Date.now() - lastCredited.creditedAt.getTime()) / 60_000;
        if (minutesSince < cooldownMinutes) {
          rejectionReason = `أقل من فترة التهدئة المسموحة (${cooldownMinutes} دقيقة) من آخر مكافأة`;
        }
      }
    }

    const monthlyCap = await this.settingsService.getNumber('referral_qr.max_monthly_bonus_cents_per_technician', 0);
    if (monthlyCap > 0 && !rejectionReason) {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthTotal = await this.bonuses
        .createQueryBuilder('b')
        .select('COALESCE(SUM(b.bonus_amount_cents), 0)', 'total')
        .where('b.technician_id = :technicianId', { technicianId: attribution.technicianId })
        .andWhere('b.status = :status', { status: TechnicianReferralBonusStatus.CREDITED })
        .andWhere('b.credited_at >= :monthStart', { monthStart })
        .getRawOne<{ total: string }>();
      const currentTotal = Number(monthTotal?.total ?? 0);
      if (currentTotal + bonusAmount > monthlyCap) {
        rejectionReason = `تجاوز الحد الأقصى الشهري للمكافآت (${monthlyCap} قرش)`;
      }
    }

    if (rejectionReason) {
      await this.bonuses.insert({
        technicianId: attribution.technicianId,
        customerUserId: customerProfile.userId,
        orderId,
        bonusAmountCents: bonusAmount,
        status: TechnicianReferralBonusStatus.REJECTED_SUSPICIOUS,
        rejectionReason,
        customerDeviceId: customerDevice?.deviceId ?? null,
      });
      this.logger.warn(`مكافأة ترشيح مرفوضة للفني ${attribution.technicianId} على الطلب ${orderId}: ${rejectionReason}`);
      return;
    }

    // ── القيد المالي — نفس نمط أي مكافأة تانية في المشروع (platform wallet كمصدر) ──
    const technician = await this.technicianProfiles.findOne({ where: { id: attribution.technicianId } });
    if (!technician) return;
    const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
    const technicianWallet = await this.walletsService.getOrCreateWallet(technician.userId, WalletOwnerType.TECHNICIAN);

    const { debit, credit } = await this.walletsService.doubleEntry({
      fromWalletId: platformWallet.id,
      toWalletId: technicianWallet.id,
      amountCents: bonusAmount,
      transactionType: WalletTxType.REFERRAL_REWARD,
      referenceType: 'technician_referral_bonus',
      referenceId: orderId,
      descriptionAr: `مكافأة ترشيح عميل — طلب #${order.orderNumber ?? orderId.slice(0, 8)}`,
      allowNegativeBalance: true,
    });

    const bonus = await this.bonuses.save(
      this.bonuses.create({
        technicianId: attribution.technicianId,
        customerUserId: customerProfile.userId,
        orderId,
        bonusAmountCents: bonusAmount,
        status: TechnicianReferralBonusStatus.CREDITED,
        creditedAt: new Date(),
        walletDebitTxId: debit.id,
        walletCreditTxId: credit.id,
        customerDeviceId: customerDevice?.deviceId ?? null,
      }),
    );

    await this.auditLog.record({
      actorUserId: null,
      actorRole: 'system',
      action: 'technician_referral.bonus_credited',
      entityType: 'technician_referral_bonus',
      entityId: bonus.id,
      newValues: { technician_id: attribution.technicianId, order_id: orderId, bonus_amount_cents: bonusAmount },
    });

    await this.notificationsService
      .notify({
        userId: technician.userId,
        notificationType: 'technician_referral.bonus_credited',
        titleAr: 'مكافأة ترشيح جديدة! 🎉',
        bodyAr: `اتحسبلك مكافأة ${(bonusAmount / 100).toFixed(0)} ج.م. عشان عميل رشّحته حجز خدمة.`,
        referenceType: 'technician_referral_bonus',
        referenceId: bonus.id,
      })
      .catch((err) => this.logger.error('فشل إشعار مكافأة الترشيح', err instanceof Error ? err.stack : err));
  }

  /** بتتنادى لما طلب اتلغى/استرد بعد ما مكافأة اتحسبت عليه بالفعل. */
  async revokeBonusForOrder(orderId: string, reason: string): Promise<void> {
    const bonus = await this.bonuses.findOne({ where: { orderId, status: TechnicianReferralBonusStatus.CREDITED } });
    if (!bonus) return;

    const debit = bonus.walletDebitTxId ? await this.walletTransactions.findOne({ where: { id: bonus.walletDebitTxId } }) : null;
    const credit = bonus.walletCreditTxId ? await this.walletTransactions.findOne({ where: { id: bonus.walletCreditTxId } }) : null;
    if (debit && credit) {
      await this.walletsService.reverseDoubleEntry({ debit, credit }, `إلغاء مكافأة ترشيح — ${reason}`);
    }

    bonus.status = TechnicianReferralBonusStatus.REVOKED;
    bonus.revokedAt = new Date();
    bonus.revokedReason = reason;
    await this.bonuses.save(bonus);

    await this.auditLog.record({
      actorUserId: null,
      actorRole: 'system',
      action: 'technician_referral.bonus_revoked',
      entityType: 'technician_referral_bonus',
      entityId: bonus.id,
      oldValues: { status: 'credited' },
      newValues: { status: 'revoked', reason },
    });

    const technician = await this.technicianProfiles.findOne({ where: { id: bonus.technicianId } });
    if (technician) {
      await this.notificationsService
        .notify({
          userId: technician.userId,
          notificationType: 'technician_referral.bonus_revoked',
          titleAr: 'إلغاء مكافأة ترشيح',
          bodyAr: `اتلغت مكافأة ترشيح كانت محسوبالك (${(bonus.bonusAmountCents / 100).toFixed(0)} ج.م.) بسبب: ${reason}`,
          referenceType: 'technician_referral_bonus',
          referenceId: bonus.id,
        })
        .catch(() => undefined);
    }
  }

  async getTechnicianSummary(technicianId: string): Promise<TechnicianReferralSummary> {
    const technician = await this.technicianProfiles.findOne({ where: { id: technicianId } });
    if (!technician) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني غير موجود', HttpStatus.NOT_FOUND);
    }
    const attributedCustomersCount = await this.attributions.count({ where: { technicianId } });
    const qualifyingOrdersCount = await this.bonuses.count({
      where: { technicianId, status: TechnicianReferralBonusStatus.CREDITED },
    });
    const [creditedTotal, revokedTotal, rejectedTotal] = await Promise.all([
      this.sumBonusAmount(technicianId, TechnicianReferralBonusStatus.CREDITED),
      this.sumBonusAmount(technicianId, TechnicianReferralBonusStatus.REVOKED),
      this.sumBonusAmount(technicianId, TechnicianReferralBonusStatus.REJECTED_SUSPICIOUS),
    ]);
    const recentBonuses = await this.bonuses.find({ where: { technicianId }, order: { createdAt: 'DESC' }, take: 20 });

    return {
      referralToken: technician.technicianCode,
      attributedCustomersCount,
      qualifyingOrdersCount,
      totalCreditedCents: creditedTotal,
      totalRevokedCents: revokedTotal,
      totalRejectedCents: rejectedTotal,
      recentBonuses,
    };
  }

  private async sumBonusAmount(technicianId: string, status: TechnicianReferralBonusStatus): Promise<number> {
    const row = await this.bonuses
      .createQueryBuilder('b')
      .select('COALESCE(SUM(b.bonus_amount_cents), 0)', 'total')
      .where('b.technician_id = :technicianId', { technicianId })
      .andWhere('b.status = :status', { status })
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  async listForAdmin(params: {
    technicianId?: string;
    status?: TechnicianReferralBonusStatus;
    from?: string;
    to?: string;
    page: number;
    perPage: number;
  }): Promise<{ items: TechnicianReferralBonus[]; meta: { page: number; per_page: number; total: number } }> {
    const qb = this.bonuses.createQueryBuilder('b').orderBy('b.createdAt', 'DESC');
    if (params.technicianId) qb.andWhere('b.technician_id = :technicianId', { technicianId: params.technicianId });
    if (params.status) qb.andWhere('b.status = :status', { status: params.status });
    if (params.from) qb.andWhere('b.created_at >= :from', { from: params.from });
    if (params.to) qb.andWhere('b.created_at <= :to', { to: params.to });

    const [items, total] = await qb
      .skip((params.page - 1) * params.perPage)
      .take(params.perPage)
      .getManyAndCount();
    return { items, meta: { page: params.page, per_page: params.perPage, total } };
  }
}
