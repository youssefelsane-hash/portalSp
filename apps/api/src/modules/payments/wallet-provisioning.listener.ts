import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { USER_REGISTERED_EVENT, UserRegisteredEvent } from '../../common/events/user-registered.event';
import { UserType } from '../auth/entities/user.entity';
import { WalletOwnerType } from './entities/wallet.entity';
import { WalletsService } from './wallets.service';

@Injectable()
export class WalletProvisioningListener {
  private readonly logger = new Logger(WalletProvisioningListener.name);

  constructor(private readonly walletsService: WalletsService) {}

  @OnEvent(USER_REGISTERED_EVENT)
  async handleUserRegistered(event: UserRegisteredEvent): Promise<void> {
    const ownerType =
      event.userType === UserType.CUSTOMER
        ? WalletOwnerType.CUSTOMER
        : event.userType === UserType.TECHNICIAN
          ? WalletOwnerType.TECHNICIAN
          : null;
    if (!ownerType) return;

    await this.walletsService.getOrCreateWallet(event.userId, ownerType);
    this.logger.log(`محفظة اتعملت لـ user ${event.userId} (${ownerType})`);
  }
}
