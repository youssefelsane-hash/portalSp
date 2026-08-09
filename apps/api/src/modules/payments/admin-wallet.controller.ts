import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { WalletsService } from './wallets.service';
import { toWalletResponseDto, toWalletTransactionResponseDto } from './dto/payments-response.dto';

// قراءة بس، مفيش @RequirePermission — نفس نمط GET /admin/customers/:userId و
// GET /admin/technicians/:id (RolesGuard كفاية، أي أدمن يقدر يشوف). طلب صريح: "الأدمن عنده
// access إنه يخش يشوف المحفظة عشان يشوف هل في مشكلة أو لأ".
@Controller('admin/wallets')
@Roles(UserType.ADMIN)
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
