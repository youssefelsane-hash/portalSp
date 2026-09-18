import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { LoyaltySource } from '../promotions/entities/loyalty-transaction.entity';
import { LoyaltyService } from '../promotions/loyalty.service';
import { SettingsService } from '../settings/settings.service';
import { PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from './entities/wallet.entity';
import { WalletTxType } from './entities/wallet-transaction.entity';
import { WalletsService } from './wallets.service';

export interface LoyaltyRedemptionQuote {
  /** الرصيد الحالي بالنقاط. */
  points_balance: number;
  redeem_enabled: boolean;
  points_per_egp: number;
  min_redeem_points: number;
  /** أكبر عدد نقاط قابل للاستبدال دلوقتي (مضاعف صحيح للسعر، عشان مايضيعش كسر). */
  redeemable_points: number;
  /** قيمة `redeemable_points` بالقروش. */
  redeemable_value_cents: number;
}

/**
 * **استبدال نقاط الولاء برصيد محفظة** (docs/08 §165، طلب مالك 2026-09-18).
 *
 * > «نقاط الولاء دي حاليًا بتتحسب وليها إعدادات عند الأدمن، ولكن هي مش كاملة — عايزك
 * > تكمّلهالي وتكون كل حاجة فعلاً جاهزة.»
 *
 * الناقص مكانش الاكتساب ولا الانتهاء (الاتنين شغّالين)، الناقص كان **القيمة**:
 * `LoyaltyService.redeem()` بيخصم نقاط ومايدّيش حاجة، والشاشة بتقول «برنامج الاستبدال جاي
 * قريب». هنا بتتحوّل النقاط لرصيد محفظة حقيقي.
 *
 * ### ليه الخدمة دي في `payments` مش في `promotions`
 *
 * `PaymentsModule` بيستورد `PromotionsModule` أصلاً، فالاتجاه ده مافيهوش دايرة. العكس
 * (حقن `WalletsService` في `LoyaltyService`) كان هيحتاج `forwardRef` على دايرة كاملة بلا داعي.
 *
 * ### ليه رصيد محفظة مش خصم على طلب
 *
 * أبسط طريقة تدّي قيمة حقيقية بلا اختراع عملة تالتة: المحفظة موجودة، وبتتصرف في أي طلب
 * (`pay-with-wallet`)، وليها سجل حركات وقيد مزدوج ومراجعة إدارية. كود خصم لكل استبدال كان
 * هيعمل مئات الأكواد الميتة.
 */
@Injectable()
export class LoyaltyRedemptionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly loyalty: LoyaltyService,
    private readonly wallets: WalletsService,
    private readonly settings: SettingsService,
  ) {}

  private async policy(): Promise<{ enabled: boolean; pointsPerEgp: number; minPoints: number }> {
    const [enabled, pointsPerEgp, minPoints] = await Promise.all([
      this.settings.getBoolean('loyalty.redeem_enabled', true),
      this.settings.getNumber('loyalty.points_per_egp_redeemed', 10),
      this.settings.getNumber('loyalty.min_redeem_points', 100),
    ]);
    return {
      enabled,
      // سعر صرف صفر أو سالب معناه قسمة على صفر — بنرجع للافتراضي بدل ما نطلّع Infinity.
      pointsPerEgp: Number.isFinite(pointsPerEgp) && pointsPerEgp > 0 ? pointsPerEgp : 10,
      minPoints: Number.isFinite(minPoints) && minPoints > 0 ? Math.floor(minPoints) : 0,
    };
  }

  /** كام يقدر يستبدل دلوقتي — للعرض قبل ما يدوس، فمفيش أي كتابة هنا. */
  async quote(userId: string): Promise<LoyaltyRedemptionQuote> {
    const { enabled, pointsPerEgp, minPoints } = await this.policy();
    const balance = await this.loyalty.getBalance(userId);
    // بنستبدل **مضاعفات السعر** بس: 105 نقطة بسعر 10 بتدي 10 جنيه و5 نقط تفضل، مش 10.5 جنيه.
    const redeemablePoints = Math.floor(balance / pointsPerEgp) * pointsPerEgp;
    return {
      points_balance: balance,
      redeem_enabled: enabled,
      points_per_egp: pointsPerEgp,
      min_redeem_points: minPoints,
      redeemable_points: redeemablePoints,
      redeemable_value_cents: Math.round((redeemablePoints / pointsPerEgp) * 100),
    };
  }

  /**
   * بيخصم النقاط **ويضيف الرصيد في نفس الترانزاكشن** — لو القيد المالي وقع، النقاط بترجع.
   * الفصل بينهم كان هيسمح بحالة «النقاط راحت والفلوس ما جتش» وهي أسوأ حالة ممكنة هنا.
   */
  async redeemToWallet(userId: string, points: number): Promise<{ points_balance: number; credited_cents: number }> {
    const { enabled, pointsPerEgp, minPoints } = await this.policy();
    if (!enabled) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'استبدال النقاط متوقّف مؤقتًا — نقاطك محفوظة وهتقدر تستبدلها لما يرجع',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!Number.isInteger(points) || points <= 0) {
      throw new ApiException(ErrorCode.VAL_001, 'عدد النقاط لازم يكون رقم صحيح أكبر من صفر', HttpStatus.BAD_REQUEST);
    }
    if (points < minPoints) {
      throw new ApiException(
        ErrorCode.VAL_001,
        `أقل عدد نقاط للاستبدال ${minPoints} نقطة`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (points % pointsPerEgp !== 0) {
      throw new ApiException(
        ErrorCode.VAL_001,
        `عدد النقاط لازم يكون من مضاعفات ${pointsPerEgp} (سعر الجنيه الواحد)`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const amountCents = Math.round((points / pointsPerEgp) * 100);
    if (amountCents <= 0) {
      throw new ApiException(ErrorCode.VAL_001, 'قيمة الاستبدال أقل من قرش', HttpStatus.BAD_REQUEST);
    }

    return this.dataSource.transaction(async (manager) => {
      // الخصم بيقفل صف العميل جوّه نفس الترانزاكشن، فسباق استبدالين مايعديش.
      const transaction = await this.loyalty.redeem(userId, points, LoyaltySource.PROMOTION, null, manager);

      const platformWallet = await this.wallets.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID, manager);
      const customerWallet = await this.wallets.getOrCreateWallet(userId, WalletOwnerType.CUSTOMER, manager);
      await this.wallets.doubleEntry(
        {
          fromWalletId: platformWallet.id,
          toWalletId: customerWallet.id,
          amountCents,
          transactionType: WalletTxType.BONUS,
          referenceType: 'loyalty_redemption',
          referenceId: transaction.id,
          descriptionAr: `استبدال ${points} نقطة ولاء`,
          // نفس قاعدة مكافأة ترشيح الفني بالحرف: المكافآت اللي **المنصة بتموّلها** بتسمح
          // برصيد سالب لمحفظة المنصة — الرقم ده تكلفة تسويقية مش رصيد مستخدم، ومنعه كان معناه
          // إن الاستبدال يفشل بـ«رصيد غير كافٍ» لأسباب مالهاش علاقة بالعميل (اتقاس حيًّا).
          allowNegativeBalance: true,
        },
        manager,
      );

      return { points_balance: transaction.balanceAfter, credited_cents: amountCents };
    });
  }
}
