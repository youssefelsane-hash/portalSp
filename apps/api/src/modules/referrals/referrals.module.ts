import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { CustomersModule } from '../customers/customers.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { SettingsModule } from '../settings/settings.module';
import { Referral } from './entities/referral.entity';
import { ReferralOrderCompletedListener } from './listeners/referral-order-completed.listener';
import { ReferralRegisteredListener } from './listeners/referral-registered.listener';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

@Module({
  imports: [TypeOrmModule.forFeature([Referral, User]), CustomersModule, PromotionsModule, SettingsModule],
  controllers: [ReferralsController],
  providers: [ReferralsService, ReferralRegisteredListener, ReferralOrderCompletedListener],
  exports: [ReferralsService],
})
export class ReferralsModule {}
