import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UserType } from '../auth/entities/user.entity';
import { WalletOwnerType } from './entities/wallet.entity';
import { WalletsService } from './wallets.service';
import { toWalletResponseDto, toWalletTransactionResponseDto } from './dto/payments-response.dto';

@Controller('wallet')
@Roles(UserType.CUSTOMER, UserType.TECHNICIAN)
export class WalletController {
  constructor(private readonly walletsService: WalletsService) {}

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
}
