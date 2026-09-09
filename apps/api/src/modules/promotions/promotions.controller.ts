import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { LoyaltySource } from './entities/loyalty-transaction.entity';
import { LoyaltyService } from './loyalty.service';
import { PromotionsService } from './promotions.service';
import { toLoyaltyTransactionResponseDto } from './dto/loyalty-transaction-response.dto';
import { toPromoCodeResponseDto } from './dto/promo-code-response.dto';
import { RedeemLoyaltyPointsDto } from './dto/redeem-loyalty-points.dto';
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

  // كانت فجوة موثّقة: LoyaltyService.redeem() كان جاهز بس مش موصول لمسار عميل. مفيش تحويل
  // تلقائي للنقاط لخصم فعلي هنا — مجرد خصم رصيد وتسجيل معاملة، القاموس مالوش سعر صرف محدد.
  @Post('loyalty/redeem')
  @HttpCode(HttpStatus.OK)
  async redeem(@CurrentUser() user: JwtPayload, @Body() dto: RedeemLoyaltyPointsDto) {
    const transaction = await this.loyaltyService.redeem(
      user.sub,
      dto.points,
      LoyaltySource.ORDER,
      dto.reference_id ?? null,
    );
    return { points_balance: transaction.balanceAfter, transaction: toLoyaltyTransactionResponseDto(transaction) };
  }
}
