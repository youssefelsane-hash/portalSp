import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { IsInt, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UserType } from '../auth/entities/user.entity';
import { WalletOwnerType } from './entities/wallet.entity';
import { LoyaltyRedemptionService } from './loyalty-redemption.service';
import { WalletsService } from './wallets.service';
import { toWalletResponseDto, toWalletTransactionResponseDto } from './dto/payments-response.dto';

class RedeemLoyaltyToWalletDto {
  @IsInt()
  @Min(1)
  points: number;
}

@Controller('wallet')
@Roles(UserType.CUSTOMER, UserType.TECHNICIAN)
export class WalletController {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly loyaltyRedemption: LoyaltyRedemptionService,
  ) {}

  @Get()
  async getMyWallet(@CurrentUser() user: JwtPayload) {
    const ownerType = user.userType === UserType.TECHNICIAN ? WalletOwnerType.TECHNICIAN : WalletOwnerType.CUSTOMER;
    const wallet = await this.walletsService.getOrCreateWallet(user.sub, ownerType);
    return toWalletResponseDto(wallet);
  }

  @Get('transactions')
  async getMyTransactions(@CurrentUser() user: JwtPayload) {
    const transactions = await this.walletsService.listTransactionsForUser(user.sub);
    return transactions.map(toWalletTransactionResponseDto);
  }

  /**
   * **استبدال نقاط الولاء برصيد المحفظة** (docs/08 §165).
   *
   * المسارين دول في `wallet` مش في `loyalty` عن قصد: ناتج العملية **رصيد محفظة**، والقواعد
   * المالية (قيد مزدوج، محفظة متجمّدة، سجل حركات) كلها هنا. `GET` قراءة بحتة عشان الشاشة
   * تعرض «تقدر تستبدل كام» قبل ما العميل يدوس.
   */
  @Get('loyalty-redemption')
  async loyaltyRedemptionQuote(@CurrentUser() user: JwtPayload) {
    return this.loyaltyRedemption.quote(user.sub);
  }

  @Post('loyalty-redemption')
  @HttpCode(HttpStatus.OK)
  async redeemLoyalty(@CurrentUser() user: JwtPayload, @Body() dto: RedeemLoyaltyToWalletDto) {
    return this.loyaltyRedemption.redeemToWallet(user.sub, dto.points);
  }
}
