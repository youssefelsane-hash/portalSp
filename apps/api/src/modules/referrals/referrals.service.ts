import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { REFERRAL_REWARD_EARNED_EVENT, ReferralRewardEarnedEvent } from '../../common/events/referral-reward-earned.event';
import { User } from '../auth/entities/user.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { DiscountType } from '../promotions/entities/promo-code.entity';
import { PLATFORM_SYSTEM_USER_ID } from '../payments/entities/wallet.entity';
import { PromoCodesService } from '../promotions/promo-codes.service';
import { SettingsService } from '../settings/settings.service';
import { Referral, ReferralStatus } from './entities/referral.entity';

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
    const existing = await this.referrals.findOne({ where: { referredUserId } });
    if (existing) return; // احتياطي دفاعي — الأصل إن كل مستخدم بيتترشح مرة واحدة بس (UNIQUE)
    await this.referrals.save(this.referrals.create({ referrerUserId, referredUserId, status: ReferralStatus.PENDING }));
  }

  /**
   * بتتنادى من ReferralOrderCompletedListener (مشترك في ORDER_STATUS_CHANGED_EVENT) لما أي طلب
   * يخلص. بتشيك: العميل ده اتترشّح ولسه معلّق + ده أول طلب مكتمل فعلي ليه (مش مجرد تسجيل) —
   * لو الاتنين صح، تقفل الترشيح وتزوّد عدّاد المُرشِّح، ولو العدّاد وصل لمضاعف جديد تصدر مكافأة.
   */
  async handleOrderCompleted(customerProfileId: string, orderId: string): Promise<void> {
    const customerProfile = await this.customerProfiles.findByProfileIdOrThrow(customerProfileId);
    const user = await this.users.findOne({ where: { id: customerProfile.userId } });
    if (!user?.referredByUserId) return; // العميل ده مش مُرشَّح من حد

    const referral = await this.referrals.findOne({
      where: { referredUserId: user.id, status: ReferralStatus.PENDING },
    });
    if (!referral) return; // اتقفل قبل كده، أو بيانات من قبل تفعيل الميزة

    // لازم AND o.deleted_at IS NULL — بدونها، طلب مكتمل اتعمله soft-delete (نادر) كان بيتحسب في
    // العدّاد فيخلي "أول طلب مكتمل" يترفض غلط (أو يزوّد الرقم عن الحقيقي وقت العملة الشهرية).
    const rows = await this.dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*) AS count FROM orders o
       JOIN customer_profiles cp ON cp.id = o.customer_id
       WHERE cp.user_id = $1 AND o.order_status = 'completed' AND o.deleted_at IS NULL`,
      [user.id],
    );
    if (Number(rows[0].count) !== 1) return; // مش أول طلب مكتمل للعميل ده

    referral.status = ReferralStatus.COMPLETED;
    referral.completedAt = new Date();
    referral.referenceOrderId = orderId;
    await this.referrals.save(referral);

    const completedCount = await this.referrals.count({
      where: { referrerUserId: referral.referrerUserId, status: ReferralStatus.COMPLETED },
    });
    const requiredPerReward = await this.settingsService.getNumber('referral.required_referrals_per_reward', 10);
    if (requiredPerReward > 0 && completedCount % requiredPerReward === 0) {
      await this.issueReward(referral.referrerUserId, completedCount, requiredPerReward);
    }
  }

  private async issueReward(referrerUserId: string, completedCount: number, requiredPerReward: number): Promise<void> {
    const rewardValueEgp = await this.settingsService.getNumber('referral.reward_value_egp', 150);
    const validityDays = await this.settingsService.getNumber('referral.reward_validity_days', 90);
    const now = new Date();
    const validUntil = new Date(now.getTime() + validityDays * 86_400_000);
    const code = `REF${randomBytes(4).toString('hex').toUpperCase()}`;
    const rewardNumber = completedCount / requiredPerReward;

    // مُصدَر من نظام promo_codes الموجود أصلاً (بطلب المستخدم صراحة) — بحساب PLATFORM_SYSTEM_USER_ID
    // كـ "الأدمن" المُصدر، مطابق لنفس الحساب النظامي المستخدم في تسويات المحفظة.
    // إصلاح أمني (migration 0067) — restricted_to_user_id بيقفل الكود على المُرشِّح نفسه بس،
    // بدل ما تكون الحماية الوحيدة "الكود بيتوصّل عبر إشعار خاص" (كانت فجوة موثّقة صراحة هنا،
    // أي حد يعرف الكود لو اتسرّب/اتشارك كان يقدر يستخدمه).
    const promo = await this.promoCodesService.create(PLATFORM_SYSTEM_USER_ID, {
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

    this.events.emit(
      REFERRAL_REWARD_EARNED_EVENT,
      new ReferralRewardEarnedEvent(referrerUserId, promo.code, rewardValueEgp, completedCount),
    );
    this.logger.log(`مكافأة ترشيح جديدة للمستخدم ${referrerUserId}: كود ${promo.code} بقيمة ${rewardValueEgp}ج`);
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
      referralCode = await this.generateUniqueReferralCode();
      await this.users.update(userId, { referralCode });
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
}
