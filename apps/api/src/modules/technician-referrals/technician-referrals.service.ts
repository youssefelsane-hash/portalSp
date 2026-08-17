import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditLogService } from '../audit/audit-log.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { UserDevice } from '../notifications/entities/user-device.entity';
import { Order } from '../orders/entities/order.entity';
import { PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from '../payments/entities/wallet.entity';
import {
  WalletTransaction,
  WalletTxDirection,
  WalletTxType,
} from '../payments/entities/wallet-transaction.entity';
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
    @InjectDataSource() private readonly dataSource: DataSource,
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

  /** Rebuilds the source row left by the pre-Phase-4 credit-then-save crash window. */
  private async recoverLegacyWalletEffect(
    manager: EntityManager,
    order: Order,
    technician: TechnicianProfile,
    customerUserId: string,
  ): Promise<TechnicianReferralBonus | null> {
    const originals = await manager.find(WalletTransaction, {
      where: {
        referenceType: 'technician_referral_bonus',
        referenceId: order.id,
        transactionType: WalletTxType.REFERRAL_REWARD,
      },
    });
    if (originals.length === 0) return null;

    const debit = originals.find((entry) => entry.direction === WalletTxDirection.DEBIT);
    const credit = originals.find((entry) => entry.direction === WalletTxDirection.CREDIT);
    if (
      originals.length !== 2 ||
      !debit ||
      !credit ||
      debit.amountCents !== credit.amountCents ||
      debit.isReversed !== credit.isReversed
    ) {
      return manager.save(
        manager.create(TechnicianReferralBonus, {
          technicianId: technician.id,
          customerUserId,
          orderId: order.id,
          bonusAmountCents: Math.max(0, ...originals.map((entry) => entry.amountCents)),
          status: TechnicianReferralBonusStatus.MANUAL_REVIEW,
          rejectionReason: `قيود مكافأة قديمة غير متسقة: ${originals.length} قيد، debit=${!!debit}، credit=${!!credit}`,
          creditedAt: null,
          customerDeviceId: null,
        }),
      );
    }

    const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID, manager);
    const technicianWallet = await this.walletsService.findByUserIdOrThrow(technician.userId, manager);
    if (debit.walletId !== platformWallet.id || credit.walletId !== technicianWallet.id) {
      return manager.save(
        manager.create(TechnicianReferralBonus, {
          technicianId: technician.id,
          customerUserId,
          orderId: order.id,
          bonusAmountCents: 0,
          status: TechnicianReferralBonusStatus.MANUAL_REVIEW,
          rejectionReason: 'أطراف قيد مكافأة الترشيح القديمة غير متطابقة وتحتاج مراجعة يدوية',
          creditedAt: null,
          customerDeviceId: null,
        }),
      );
    }

    const wasReversed = debit.isReversed && credit.isReversed;
    if (wasReversed && (!debit.reversalTransactionId || !credit.reversalTransactionId)) {
      return manager.save(
        manager.create(TechnicianReferralBonus, {
          technicianId: technician.id,
          customerUserId,
          orderId: order.id,
          bonusAmountCents: 0,
          status: TechnicianReferralBonusStatus.MANUAL_REVIEW,
          rejectionReason: 'قيد مكافأة قديم معلّم كمعكوس بلا مراجع العكس وتحتاج حالته مراجعة يدوية',
          creditedAt: null,
          customerDeviceId: null,
        }),
      );
    }

    return manager.save(
      manager.create(TechnicianReferralBonus, {
        technicianId: technician.id,
        customerUserId,
        orderId: order.id,
        bonusAmountCents: debit.amountCents,
        status: wasReversed ? TechnicianReferralBonusStatus.REVOKED : TechnicianReferralBonusStatus.CREDITED,
        rejectionReason: null,
        creditedAt: credit.createdAt,
        revokedAt: wasReversed ? new Date() : null,
        revokedReason: wasReversed ? 'استرداد سجل مكافأة قديم معكوس بالفعل' : null,
        walletDebitTxId: debit.id,
        walletCreditTxId: credit.id,
        customerDeviceId: null,
      }),
    );
  }

  /** بتتنادى من TechnicianReferralOrderStatusListener على أي ORDER_STATUS_CHANGED_EVENT. */
  async evaluateOrderForBonus(orderId: string, newStatus: string): Promise<void> {
    const [enabled, minStatusValue, rewardModeValue, minOrderAmount, bonusAmount, rejectDuplicateDevice, cooldownMinutes, monthlyCap] =
      await Promise.all([
        this.settingsService.getBoolean('referral_qr.enabled', true),
        this.settingsService.getString('referral_qr.qualifying_min_order_status', 'completed'),
        this.settingsService.getString('referral_qr.reward_mode', 'first_order_only'),
        this.settingsService.getNumber('referral_qr.min_order_amount_cents', 0),
        this.settingsService.getNumber('referral_qr.bonus_amount_cents', 5000),
        this.settingsService.getBoolean('referral_qr.reject_duplicate_device', true),
        this.settingsService.getNumber('referral_qr.min_minutes_between_bonuses', 0),
        this.settingsService.getNumber('referral_qr.max_monthly_bonus_cents_per_technician', 0),
      ]);
    if (!enabled) return;

    const minStatus = minStatusValue as QualifyingStatus;
    const rewardMode = rewardModeValue as RewardMode;
    if (!['accepted', 'work_completed', 'completed'].includes(newStatus)) return;
    if (this.rankOf(newStatus as QualifyingStatus) < this.rankOf(minStatus)) return;
    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'order')
        .setLock('pessimistic_write')
        .where('order.id = :orderId', { orderId })
        .getOne();
      if (!order || !['accepted', 'work_completed', 'completed'].includes(order.orderStatus)) return null;
      if (this.rankOf(order.orderStatus as QualifyingStatus) < this.rankOf(minStatus)) return null;

      if (await manager.findOne(TechnicianReferralBonus, { where: { orderId } })) return null;
      const customerProfile = await manager.findOne(CustomerProfile, { where: { id: order.customerId } });
      if (!customerProfile) return null;
      const attribution = await manager
        .createQueryBuilder(TechnicianReferralAttribution, 'attribution')
        .setLock('pessimistic_write')
        .where('attribution.customer_user_id = :customerUserId', { customerUserId: customerProfile.userId })
        .getOne();
      if (!attribution) return null;
      const technician = await manager
        .createQueryBuilder(TechnicianProfile, 'technician')
        .setLock('pessimistic_write')
        .where('technician.id = :technicianId', { technicianId: attribution.technicianId })
        .getOne();
      if (!technician) return null;

      const legacyBonus = await this.recoverLegacyWalletEffect(
        manager,
        order,
        technician,
        customerProfile.userId,
      );
      if (legacyBonus) {
        if (legacyBonus.status === TechnicianReferralBonusStatus.REVOKED) {
          await this.auditLog.record(
            {
              actorUserId: null,
              actorRole: 'system',
              action: 'technician_referral.bonus_revoked',
              entityType: 'technician_referral_bonus',
              entityId: legacyBonus.id,
              newValues: { status: 'revoked', recovered_legacy_effect: true },
            },
            manager,
          );
          return null;
        }
        if (legacyBonus.status === TechnicianReferralBonusStatus.MANUAL_REVIEW) {
          await this.auditLog.record(
            {
              actorUserId: null,
              actorRole: 'system',
              action: 'technician_referral.bonus_manual_review',
              entityType: 'technician_referral_bonus',
              entityId: legacyBonus.id,
              newValues: { reason: legacyBonus.rejectionReason, recovered_legacy_effect: true },
            },
            manager,
          );
          return {
            bonus: legacyBonus,
            technician,
            rejectionReason: legacyBonus.rejectionReason,
            credited: false,
          };
        }
        await this.auditLog.record(
          {
            actorUserId: null,
            actorRole: 'system',
            action: 'technician_referral.bonus_credited',
            entityType: 'technician_referral_bonus',
            entityId: legacyBonus.id,
            newValues: {
              technician_id: legacyBonus.technicianId,
              order_id: orderId,
              bonus_amount_cents: legacyBonus.bonusAmountCents,
              recovered_legacy_effect: true,
            },
          },
          manager,
        );
        return { bonus: legacyBonus, technician, rejectionReason: null, credited: true };
      }

      let rejectionReason: string | null = null;
      if (rewardMode === 'first_order_only') {
        const priorCredited = await manager.count(TechnicianReferralBonus, {
          where: {
            technicianId: attribution.technicianId,
            customerUserId: customerProfile.userId,
            status: TechnicianReferralBonusStatus.CREDITED,
          },
        });
        if (priorCredited > 0) {
          rejectionReason = 'سبق احتساب مكافأة أول طلب مؤهل لهذا العميل';
        }
      }
      if (minOrderAmount > 0 && order.totalAmountCents < minOrderAmount && !rejectionReason) {
        rejectionReason = `قيمة الطلب أقل من الحد الأدنى للمكافأة (${minOrderAmount} قرش)`;
      }

      const customerDevice = await manager.findOne(UserDevice, {
        where: { userId: customerProfile.userId, isActive: true },
      });
      if (rejectDuplicateDevice && customerDevice && !rejectionReason) {
        const priorBonusFromSameDevice = await manager.findOne(TechnicianReferralBonus, {
          where: { technicianId: attribution.technicianId, customerDeviceId: customerDevice.deviceId },
        });
        if (priorBonusFromSameDevice && priorBonusFromSameDevice.customerUserId !== customerProfile.userId) {
          rejectionReason = 'نفس الجهاز استُخدم قبل كده لعميل مختلف اتكافأ عليه الفني ده — احتمال حسابات وهمية';
        } else {
          const technicianDevice = await manager.findOne(UserDevice, {
            where: { userId: technician.userId, isActive: true },
          });
          if (technicianDevice?.deviceId === customerDevice.deviceId) {
            rejectionReason = 'نفس جهاز الفني حاليًا — احتمال ترشيح ذاتي بحساب عميل وهمي';
          }
        }
      }

      if (cooldownMinutes > 0 && !rejectionReason) {
        const lastCredited = await manager.findOne(TechnicianReferralBonus, {
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

      if (monthlyCap > 0 && !rejectionReason) {
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const monthTotal = await manager
          .createQueryBuilder(TechnicianReferralBonus, 'bonus')
          .select('COALESCE(SUM(bonus.bonus_amount_cents), 0)', 'total')
          .where('bonus.technician_id = :technicianId', { technicianId: attribution.technicianId })
          .andWhere('bonus.status = :status', { status: TechnicianReferralBonusStatus.CREDITED })
          .andWhere('bonus.credited_at >= :monthStart', { monthStart })
          .getRawOne<{ total: string }>();
        if (Number(monthTotal?.total ?? 0) + bonusAmount > monthlyCap) {
          rejectionReason = `تجاوز الحد الأقصى الشهري للمكافآت (${monthlyCap} قرش)`;
        }
      }

      const bonus = manager.create(TechnicianReferralBonus, {
        technicianId: attribution.technicianId,
        customerUserId: customerProfile.userId,
        orderId,
        bonusAmountCents: bonusAmount,
        status: rejectionReason
          ? TechnicianReferralBonusStatus.REJECTED_SUSPICIOUS
          : TechnicianReferralBonusStatus.CREDITED,
        rejectionReason,
        creditedAt: rejectionReason ? null : new Date(),
        customerDeviceId: customerDevice?.deviceId ?? null,
      });
      await manager.save(bonus);
      if (rejectionReason) {
        await this.auditLog.record(
          {
            actorUserId: null,
            actorRole: 'system',
            action: 'technician_referral.bonus_rejected',
            entityType: 'technician_referral_bonus',
            entityId: bonus.id,
            newValues: {
              technician_id: bonus.technicianId,
              order_id: orderId,
              rejection_reason: rejectionReason,
            },
          },
          manager,
        );
        return { bonus, technician, rejectionReason, credited: false };
      }

      const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID, manager);
      const technicianWallet = await this.walletsService.getOrCreateWallet(
        technician.userId,
        WalletOwnerType.TECHNICIAN,
        manager,
      );
      const { debit, credit } = await this.walletsService.doubleEntry(
        {
          fromWalletId: platformWallet.id,
          toWalletId: technicianWallet.id,
          amountCents: bonusAmount,
          transactionType: WalletTxType.REFERRAL_REWARD,
          referenceType: 'technician_referral_bonus',
          referenceId: bonus.id,
          descriptionAr: `مكافأة ترشيح عميل — طلب #${order.orderNumber ?? orderId.slice(0, 8)}`,
          allowNegativeBalance: true,
        },
        manager,
      );
      bonus.walletDebitTxId = debit.id;
      bonus.walletCreditTxId = credit.id;
      await manager.save(bonus);
      await this.auditLog.record(
        {
          actorUserId: null,
          actorRole: 'system',
          action: 'technician_referral.bonus_credited',
          entityType: 'technician_referral_bonus',
          entityId: bonus.id,
          newValues: {
            technician_id: bonus.technicianId,
            order_id: orderId,
            bonus_amount_cents: bonus.bonusAmountCents,
          },
        },
        manager,
      );
      return { bonus, technician, rejectionReason: null, credited: true };
    });

    if (!result) return;
    if (!result.credited) {
      this.logger.warn(
        `مكافأة ترشيح مرفوضة للفني ${result.bonus.technicianId} على الطلب ${orderId}: ${result.rejectionReason}`,
      );
      return;
    }

    const { bonus, technician } = result;

    await this.notificationsService
      .notify({
        userId: technician.userId,
        notificationType: 'technician_referral.bonus_credited',
        titleAr: 'مكافأة ترشيح جديدة! 🎉',
        bodyAr: `اتحسبلك مكافأة ${(bonus.bonusAmountCents / 100).toFixed(0)} ج.م. عشان عميل رشّحته حجز خدمة.`,
        referenceType: 'technician_referral_bonus',
        referenceId: bonus.id,
      })
      .catch((err) => this.logger.error('فشل إشعار مكافأة الترشيح', err instanceof Error ? err.stack : err));
  }

  /** بتتنادى لما طلب اتلغى/استرد بعد ما مكافأة اتحسبت عليه بالفعل. */
  async revokeBonusForOrder(orderId: string, reason: string): Promise<void> {
    const bonus = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'order')
        .withDeleted()
        .setLock('pessimistic_write')
        .where('order.id = :orderId', { orderId })
        .getOne();
      if (!order) return null;
      const lockedBonus = await manager
        .createQueryBuilder(TechnicianReferralBonus, 'bonus')
        .setLock('pessimistic_write')
        .where('bonus.order_id = :orderId', { orderId })
        .getOne();
      if (!lockedBonus || lockedBonus.status !== TechnicianReferralBonusStatus.CREDITED) return null;
      if (!lockedBonus.walletDebitTxId || !lockedBonus.walletCreditTxId) {
        throw new ApiException(ErrorCode.VAL_001, 'مكافأة الترشيح بلا قيود محفظة مكتملة', HttpStatus.CONFLICT);
      }
      const debit = await manager.findOneByOrFail(WalletTransaction, { id: lockedBonus.walletDebitTxId });
      const credit = await manager.findOneByOrFail(WalletTransaction, { id: lockedBonus.walletCreditTxId });
      await this.walletsService.reverseDoubleEntry(
        { debit, credit },
        `إلغاء مكافأة ترشيح — ${reason}`,
        undefined,
        manager,
      );
      lockedBonus.status = TechnicianReferralBonusStatus.REVOKED;
      lockedBonus.revokedAt = new Date();
      lockedBonus.revokedReason = reason;
      await manager.save(lockedBonus);
      await this.auditLog.record(
        {
          actorUserId: null,
          actorRole: 'system',
          action: 'technician_referral.bonus_revoked',
          entityType: 'technician_referral_bonus',
          entityId: lockedBonus.id,
          oldValues: { status: 'credited' },
          newValues: { status: 'revoked', reason },
        },
        manager,
      );
      return lockedBonus;
    });
    if (!bonus) return;

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

  /** Replays missed reward/revoke events from durable order and attribution state. */
  async reconcilePendingBonuses(limit = 25): Promise<number> {
    const boundedLimit = Math.max(1, Math.floor(limit));
    const legacyOrphans = await this.dataSource.query<{
      id: string;
      order_status: string;
      deleted_at: Date | null;
    }[]>(
      `SELECT DISTINCT o.id, o.order_status, o.deleted_at
       FROM orders o
       JOIN wallet_transactions wt
         ON wt.reference_type = 'technician_referral_bonus'
        AND wt.reference_id = o.id
        AND wt.transaction_type = 'referral_reward'
       LEFT JOIN technician_referral_bonuses b ON b.order_id = o.id
       WHERE b.id IS NULL
       ORDER BY o.id ASC
       LIMIT $1`,
      [boundedLimit],
    );
    for (const order of legacyOrphans) {
      const recovered = await this.recoverLegacyBonusRecord(order.id);
      if (
        recovered?.status === TechnicianReferralBonusStatus.CREDITED &&
        (order.deleted_at !== null ||
          ['cancelled_by_customer', 'cancelled_by_technician', 'cancelled_by_system', 'refunded'].includes(
            order.order_status,
          ))
      ) {
        await this.revokeBonusForOrder(
          order.id,
          order.deleted_at
            ? 'استرداد قيد قديم بعد حذف الطلب منطقيًا'
            : `استرداد قيد قديم بعد أن أصبح الطلب ${order.order_status}`,
        );
      }
    }

    const afterLegacy = boundedLimit - legacyOrphans.length;
    if (afterLegacy <= 0) return legacyOrphans.length;
    const revocations = await this.dataSource.query<{ id: string; order_status: string }[]>(
      `SELECT o.id, o.order_status
       FROM orders o
       JOIN technician_referral_bonuses b ON b.order_id = o.id AND b.status = 'credited'
       WHERE o.deleted_at IS NULL
         AND o.order_status IN ('cancelled_by_customer', 'cancelled_by_technician', 'cancelled_by_system', 'refunded')
       ORDER BY o.updated_at ASC, o.id ASC
       LIMIT $1`,
      [afterLegacy],
    );
    for (const order of revocations) {
      await this.revokeBonusForOrder(order.id, `استرداد دوري بعد أن أصبح الطلب ${order.order_status}`);
    }

    const remaining = afterLegacy - revocations.length;
    if (remaining <= 0 || !(await this.settingsService.getBoolean('referral_qr.enabled', true))) {
      return legacyOrphans.length + revocations.length;
    }
    const rewards = await this.dataSource.query<{ id: string; order_status: string }[]>(
      `SELECT o.id, o.order_status
       FROM orders o
       JOIN customer_profiles cp ON cp.id = o.customer_id
       JOIN technician_referral_attributions a ON a.customer_user_id = cp.user_id
       LEFT JOIN technician_referral_bonuses b ON b.order_id = o.id
       WHERE o.deleted_at IS NULL
         AND o.order_status IN ('accepted', 'work_completed', 'completed')
         AND b.id IS NULL
       ORDER BY o.updated_at ASC, o.id ASC
       LIMIT $1`,
      [remaining],
    );
    for (const order of rewards) {
      await this.evaluateOrderForBonus(order.id, order.order_status);
    }
    return legacyOrphans.length + revocations.length + rewards.length;
  }

  private async recoverLegacyBonusRecord(orderId: string): Promise<TechnicianReferralBonus | null> {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'order')
        .withDeleted()
        .setLock('pessimistic_write')
        .where('order.id = :orderId', { orderId })
        .getOne();
      if (!order) return null;
      const existing = await manager.findOne(TechnicianReferralBonus, { where: { orderId } });
      if (existing) return existing;
      const customerProfile = await manager.findOne(CustomerProfile, { where: { id: order.customerId } });
      if (!customerProfile) return null;
      const attribution = await manager
        .createQueryBuilder(TechnicianReferralAttribution, 'attribution')
        .setLock('pessimistic_write')
        .where('attribution.customer_user_id = :customerUserId', { customerUserId: customerProfile.userId })
        .getOne();
      if (!attribution) return null;
      const technician = await manager
        .createQueryBuilder(TechnicianProfile, 'technician')
        .setLock('pessimistic_write')
        .where('technician.id = :technicianId', { technicianId: attribution.technicianId })
        .getOne();
      if (!technician) return null;
      return this.recoverLegacyWalletEffect(manager, order, technician, customerProfile.userId);
    });
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
