import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { LoyaltyService } from './loyalty.service';
import { PromotionsService } from './promotions.service';
import { toLoyaltyTransactionResponseDto } from './dto/loyalty-transaction-response.dto';
import { toPromoCodeResponseDto } from './dto/promo-code-response.dto';
import { ValidatePromoCodeQueryDto } from './dto/validate-promo-code-query.dto';

// مفتوح لأي مستخدم مسجّل دخول (عميل بيتحقق من كود قبل ما يحجز، مفيش @Roles مخصوصة)
@Controller()
export class PromotionsController {
  constructor(
    private readonly promotionsService: PromotionsService,
    private readonly loyaltyService: LoyaltyService,
  ) {}

  /**
   * **سقف أضيق من الافتراضي عمدًا (ج-٩)**: كود الخصم **سر قابل للتخمين** — كل محاولة فاشلة
   * مجانية بتقرّب المهاجم من خصم حقيقي على حسابنا. الحد العام (٦٠/دقيقة) بيدّي ٨٦٬٤٠٠ تخمينة
   * في اليوم من جهاز واحد، وده كفاية لفضاء أكواد قصير.
   *
   * ١٠/دقيقة أوسع بكتير من أي استخدام بشري حقيقي (العميل بيكتب كود أو اتنين قبل ما يحجز)
   * وأضيق بكتير من تخمين مفيد. الـtracker بيعدّ بالـIP هنا (مفيش `phone_number` في الحمولة)،
   * وده مقبول للمسار ده تحديدًا لأنه محتاج توكن صالح أصلاً — فتكلفة تدوير الهوية عالية.
   */
  @Get('promo-codes/:code/validate')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async validate(@CurrentUser() user: JwtPayload, @Param('code') code: string, @Query() query: ValidatePromoCodeQueryDto) {
    const { promoCode, discountCents } = await this.promotionsService.previewForOrder(
      user.sub,
      code,
      query.service_id,
      query.address_id,
      query.field_values,
    );
    return { promo_code: toPromoCodeResponseDto(promoCode), discount_cents: discountCents };
  }

  @Get('loyalty/balance')
  async balance(@CurrentUser() user: JwtPayload) {
    return { points_balance: await this.loyaltyService.getBalance(user.sub) };
  }

  @Get('loyalty/transactions')
  async transactions(@CurrentUser() user: JwtPayload) {
    const transactions = await this.loyaltyService.listTransactions(user.sub);
    return transactions.map(toLoyaltyTransactionResponseDto);
  }

  /*
    `POST /loyalty/redeem` **اتشال** (docs/08 §165).

    كان بيخصم نقاط **ومايدّيش أي حاجة** — «القاموس مالوش سعر صرف محدد» بنص تعليقه. يعني أي
    عميل ينده عليه يخسر نقاطه مقابل صفر. مفيش أي عميل بينده عليه (اتأكدنا بالبحث في التطبيقين
    والويب واللوحة)، فشيله مابيكسرش حاجة وبيقفل فخ.

    البديل الحقيقي: `POST /wallet/loyalty-redemption` — بيخصم النقاط **ويضيف رصيد محفظة** في
    نفس الترانزاكشن بسعر صرف من الإعدادات. مكانه في `payments` لأن الناتج رصيد والقواعد
    المالية هناك.

    و`LoyaltyService.redeem()` نفسها فضلت زي ما هي كـprimitive — هي اللي الخدمة الجديدة
    بتستخدمها.
  */
}
