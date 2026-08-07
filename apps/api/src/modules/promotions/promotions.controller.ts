import { Controller, Get, Param, Query } from '@nestjs/common';
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

  @Get('promo-codes/:code/validate')
  async validate(@CurrentUser() user: JwtPayload, @Param('code') code: string, @Query() query: ValidatePromoCodeQueryDto) {
    const { promoCode, discountCents } = await this.promotionsService.previewForOrder(
      user.sub,
      code,
      query.service_id,
      query.address_id,
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
}
