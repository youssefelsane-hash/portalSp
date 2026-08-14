import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { WalletsService } from './wallets.service';
import { toWalletResponseDto, toWalletTransactionResponseDto } from './dto/payments-response.dto';

// بَقّة أمنية اتصلحت (docs/08 §19 بند 8): كانت قراءة بس بلا @RequirePermission (RolesGuard بس،
// أي أدمن يقدر يشوف) — قرار سابق موثّق هنا نفسه ("الأدمن عنده access يشوف المحفظة عشان يشوف هل
// في مشكلة أو لأ")، بس تدقيق لاحق من المالك طلب صراحة إن المحافظ/البيانات المالية الحساسة تبقى
// default-deny زي refunds.issue/payouts.approve بالظبط — ده تصحيح واعي لقرار سابق أوسع من اللازم،
// مش نسيان. wallets.view جديدة (migration 0099)، ممنوحة لـfinance (super_admin بياخدها bypass).
@Controller('admin/wallets')
@Roles(UserType.ADMIN)
@RequirePermission('wallets.view')
export class AdminWalletController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get(':userId')
  async getWallet(@Param('userId', ParseUUIDPipe) userId: string) {
    const [wallet, transactions] = await Promise.all([
      this.walletsService.findByUserIdOrThrow(userId),
      this.walletsService.listTransactionsForUser(userId),
    ]);
    return {
      wallet: toWalletResponseDto(wallet),
      transactions: transactions.map(toWalletTransactionResponseDto),
    };
  }
}
