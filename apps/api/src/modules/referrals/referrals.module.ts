import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { CustomersModule } from '../customers/customers.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { SettingsModule } from '../settings/settings.module';
import { Referral } from './entities/referral.entity';
import { ReferralReward } from './entities/referral-reward.entity';
import { ReferralRecoveryService } from './referral-recovery.service';
import { ReferralOrderCompletedListener } from './listeners/referral-order-completed.listener';
import { ReferralRegisteredListener } from './listeners/referral-registered.listener';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

@Module({
  imports: [TypeOrmModule.forFeature([Referral, ReferralReward, User]), CustomersModule, PromotionsModule, SettingsModule],
  controllers: [ReferralsController],
  providers: [ReferralsService, ReferralRecoveryService, ReferralRegisteredListener, ReferralOrderCompletedListener],
  exports: [ReferralsService],
})
export class ReferralsModule {}
