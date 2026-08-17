import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { REFERRAL_REWARD_EARNED_EVENT, ReferralRewardEarnedEvent } from '../../common/events/referral-reward-earned.event';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { User } from '../auth/entities/user.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { DiscountType } from '../promotions/entities/promo-code.entity';
import { PLATFORM_SYSTEM_USER_ID } from '../payments/entities/wallet.entity';
import { PromoCodesService } from '../promotions/promo-codes.service';
import { SettingsService } from '../settings/settings.service';
import { Referral, ReferralStatus } from './entities/referral.entity';
import { ReferralReward } from './entities/referral-reward.entity';

// أحرف واضحة بصريًا بس — استبعاد 0/O و1/I لتقليل غلطات النسخ اليدوي للكود (الفني/العميل بيقول
// الكود بصوته أو يبعته سكرين شوت لصاحبه)
const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REFERRAL_CODE_LENGTH = 6;
const MAX_CODE_GENERATION_ATTEMPTS = 10;

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Referral) private readonly referrals: Repository<Referral>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly promoCodesService: PromoCodesService,
    private readonly settingsService: SettingsService,
    private readonly events: EventEmitter2,
  ) {}

  /** بتتنادى من AuthService.register() لكل مستخدم جديد — الكود شخصي وثابت طول عمر الحساب. */
  async generateUniqueReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
      let code = '';
      const bytes = randomBytes(REFERRAL_CODE_LENGTH);
      for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
        code += REFERRAL_CODE_ALPHABET[bytes[i] % REFERRAL_CODE_ALPHABET.length];
      }
      const existing = await this.users.findOne({ where: { referralCode: code } });
      if (!existing) return code;
    }
    // احتمال شبه معدوم إحصائيًا (32^6 ≈ مليار احتمال) — لو حصل فعلاً، فشل واضح أحسن من حلقة لا نهائية
    throw new Error('فشل توليد كود ترشيح فريد بعد عدة محاولات');
  }

  async findByReferralCode(code: string): Promise<User | null> {
    return this.users.findOne({ where: { referralCode: code.toUpperCase() } });
  }

  /** بتتنادى من ReferralRegisteredListener لما مستخدم جديد يسجّل بكود ترشيح صحيح. */
  async createPendingReferral(referrerUserId: string, referredUserId: string): Promise<void> {
    await this.referrals
      .createQueryBuilder()
      .insert()
      .into(Referral)
      .values({ referrerUserId, referredUserId, status: ReferralStatus.PENDING })
      .orIgnore()
      .execute();
  }

  /**
   * بتتنادى من ReferralOrderCompletedListener (مشترك في ORDER_STATUS_CHANGED_EVENT) لما أي طلب
   * يخلص. بتشيك: العميل ده اتترشّح ولسه معلّق + ده أول طلب مكتمل فعلي ليه (مش مجرد تسجيل) —
   * لو الاتنين صح، تقفل الترشيح وتزوّد عدّاد المُرشِّح، ولو العدّاد وصل لمضاعف جديد تصدر مكافأة.
   */
  async handleOrderCompleted(customerProfileId: string, orderId: string): Promise<void> {
    const requiredPerReward = await this.settingsService.getNumber('referral.required_referrals_per_reward', 10);
    const rewardValueEgp = await this.settingsService.getNumber('referral.reward_value_egp', 150);
    const validityDays = await this.settingsService.getNumber('referral.reward_validity_days', 90);
    const result = await this.dataSource.transaction(async (manager) => {
      const customerProfile = await manager.findOne(CustomerProfile, { where: { id: customerProfileId } });
      if (!customerProfile) return null;
      const order = await manager.findOne(Order, {
        where: { id: orderId, customerId: customerProfileId, orderStatus: OrderStatus.COMPLETED },
      });
      if (!order || order.deletedAt) return null;

      const referral = await manager
        .createQueryBuilder(Referral, 'referral')
        .setLock('pessimistic_write')
        .where('referral.referred_user_id = :referredUserId', { referredUserId: customerProfile.userId })
        .andWhere('referral.status = :status', { status: ReferralStatus.PENDING })
        .andWhere('referral.deleted_at IS NULL')
        .getOne();
      if (!referral) return null;

      const referrer = await manager
        .createQueryBuilder(User, 'user')
        .setLock('pessimistic_write')
        .where('user.id = :referrerUserId', { referrerUserId: referral.referrerUserId })
        .getOne();
      if (!referrer) return null;

      referral.status = ReferralStatus.COMPLETED;
      referral.completedAt = new Date();
      referral.referenceOrderId = orderId;
      await manager.save(referral);

      const completedCount = await manager.count(Referral, {
        where: { referrerUserId: referral.referrerUserId, status: ReferralStatus.COMPLETED },
      });
      if (requiredPerReward <= 0 || completedCount % requiredPerReward !== 0) return null;
      const existingReward = await manager.findOne(ReferralReward, {
        where: { referrerUserId: referral.referrerUserId, milestoneCount: completedCount },
      });
      if (existingReward) return null;

      const promo = await this.issueRewardInTransaction(
        manager,
        referral.referrerUserId,
        completedCount,
        requiredPerReward,
        rewardValueEgp,
        validityDays,
      );
      await manager.save(
        manager.create(ReferralReward, {
          referrerUserId: referral.referrerUserId,
          milestoneCount: completedCount,
          promoCodeId: promo.id,
        }),
      );
      return { referrerUserId: referral.referrerUserId, completedCount, promo };
    });

    if (!result) return;
    await this.promoCodesService.recordCreatedAudit(PLATFORM_SYSTEM_USER_ID, result.promo);
    this.events.emit(
      REFERRAL_REWARD_EARNED_EVENT,
      new ReferralRewardEarnedEvent(result.referrerUserId, result.promo.code, rewardValueEgp, result.completedCount),
    );
    this.logger.log(
      `مكافأة ترشيح جديدة للمستخدم ${result.referrerUserId}: كود ${result.promo.code} بقيمة ${rewardValueEgp}ج`,
    );
  }

  private async issueRewardInTransaction(
    manager: EntityManager,
    referrerUserId: string,
    completedCount: number,
    requiredPerReward: number,
    rewardValueEgp: number,
    validityDays: number,
  ) {
    const now = new Date();
    const validUntil = new Date(now.getTime() + validityDays * 86_400_000);
    const code = `REF${randomBytes(4).toString('hex').toUpperCase()}`;
    const rewardNumber = completedCount / requiredPerReward;

    // مُصدَر من نظام promo_codes الموجود أصلاً (بطلب المستخدم صراحة) — بحساب PLATFORM_SYSTEM_USER_ID
    // كـ "الأدمن" المُصدر، مطابق لنفس الحساب النظامي المستخدم في تسويات المحفظة.
    // إصلاح أمني (migration 0067) — restricted_to_user_id بيقفل الكود على المُرشِّح نفسه بس،
    // بدل ما تكون الحماية الوحيدة "الكود بيتوصّل عبر إشعار خاص" (كانت فجوة موثّقة صراحة هنا،
    // أي حد يعرف الكود لو اتسرّب/اتشارك كان يقدر يستخدمه).
    return this.promoCodesService.createInTransaction(manager, PLATFORM_SYSTEM_USER_ID, {
      code,
      name_ar: `مكافأة ترشيح #${rewardNumber} — ${requiredPerReward} ترشيحات مكتملة`,
      discount_type: DiscountType.FIXED_AMOUNT,
      discount_value: rewardValueEgp,
      usage_limit_total: 1,
      usage_limit_per_user: 1,
      new_customers_only: false,
      valid_from: now.toISOString(),
      valid_until: validUntil.toISOString(),
      restricted_to_user_id: referrerUserId,
    });
  }

  async reconcilePending(limit = 25): Promise<number> {
    await this.dataSource.query(
      `INSERT INTO referrals (referrer_user_id, referred_user_id, status)
       SELECT u.referred_by_user_id, u.id, 'pending'
       FROM users u
       WHERE u.referred_by_user_id IS NOT NULL AND u.deleted_at IS NULL
       ON CONFLICT (referred_user_id) DO NOTHING`,
    );
    const candidates = await this.dataSource.query<{ customer_profile_id: string; order_id: string }[]>(
      `SELECT cp.id AS customer_profile_id, completed_order.id AS order_id
       FROM referrals r
       JOIN customer_profiles cp ON cp.user_id = r.referred_user_id
       JOIN LATERAL (
         SELECT o.id
         FROM orders o
         WHERE o.customer_id = cp.id
           AND o.order_status = 'completed'
           AND o.deleted_at IS NULL
         ORDER BY o.created_at ASC, o.id ASC
         LIMIT 1
       ) completed_order ON true
       WHERE r.status = 'pending' AND r.deleted_at IS NULL
       ORDER BY r.created_at ASC
       LIMIT $1`,
      [Math.max(1, Math.floor(limit))],
    );
    for (const candidate of candidates) {
      await this.handleOrderCompleted(candidate.customer_profile_id, candidate.order_id);
    }
    return candidates.length;
  }

  async getMyReferralInfo(userId: string): Promise<{
    referralCode: string;
    completedReferralsCount: number;
    pendingReferralsCount: number;
    requiredReferralsPerReward: number;
  }> {
    const user = await this.users.findOne({ where: { id: userId } });
    let referralCode = user?.referralCode ?? null;
    // مستخدمين اتسجلوا قبل تفعيل الميزة دي ممكن يكون referral_code فاضي عندهم — نولّده كسل هنا
    if (user && !referralCode) {
      referralCode = await this.assignReferralCode(userId);
    }

    const [completedReferralsCount, pendingReferralsCount, requiredReferralsPerReward] = await Promise.all([
      this.referrals.count({ where: { referrerUserId: userId, status: ReferralStatus.COMPLETED } }),
      this.referrals.count({ where: { referrerUserId: userId, status: ReferralStatus.PENDING } }),
      this.settingsService.getNumber('referral.required_referrals_per_reward', 10),
    ]);

    return {
      referralCode: referralCode ?? '',
      completedReferralsCount,
      pendingReferralsCount,
      requiredReferralsPerReward,
    };
  }

  private async assignReferralCode(userId: string): Promise<string> {
    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
      let code = '';
      const bytes = randomBytes(REFERRAL_CODE_LENGTH);
      for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
        code += REFERRAL_CODE_ALPHABET[bytes[i] % REFERRAL_CODE_ALPHABET.length];
      }
      try {
        const updated = await this.dataSource.query<{ id: string }[]>(
          `UPDATE users SET referral_code = $2
           WHERE id = $1 AND referral_code IS NULL
           RETURNING id`,
          [userId, code],
        );
        if (updated[0]?.id) return code;
        const persisted = await this.users.findOne({ where: { id: userId } });
        if (persisted?.referralCode) return persisted.referralCode;
        throw new ApiException(ErrorCode.VAL_001, 'المستخدم غير موجود', HttpStatus.NOT_FOUND);
      } catch (err) {
        if ((err as { code?: string }).code === '23505') continue;
        throw err;
      }
    }
    throw new Error('فشل تعيين كود ترشيح فريد بعد عدة محاولات');
  }
}
