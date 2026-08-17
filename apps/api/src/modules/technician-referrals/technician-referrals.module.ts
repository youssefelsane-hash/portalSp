import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { UserDevice } from '../notifications/entities/user-device.entity';
import { Order } from '../orders/entities/order.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';
import { PaymentsModule } from '../payments/payments.module';
import { SettingsModule } from '../settings/settings.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { AdminTechnicianReferralsController } from './admin-technician-referrals.controller';
import { TechnicianReferralAttribution } from './entities/technician-referral-attribution.entity';
import { TechnicianReferralBonus } from './entities/technician-referral-bonus.entity';
import { TechnicianReferralCapturedListener } from './listeners/technician-referral-captured.listener';
import { TechnicianReferralOrderStatusListener } from './listeners/technician-referral-order-status.listener';
import { MeTechnicianReferralController } from './me-technician-referral.controller';
import { TechnicianReferralsController } from './technician-referrals.controller';
import { TechnicianReferralRecoveryService } from './technician-referral-recovery.service';
import { TechnicianReferralsService } from './technician-referrals.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TechnicianReferralAttribution,
      TechnicianReferralBonus,
      TechnicianProfile,
      Order,
      CustomerProfile,
      UserDevice,
      WalletTransaction,
    ]),
    SettingsModule,
    PaymentsModule,
    AuditModule,
    NotificationsModule,
    TechniciansModule,
  ],
  controllers: [TechnicianReferralsController, MeTechnicianReferralController, AdminTechnicianReferralsController],
  providers: [
    TechnicianReferralsService,
    TechnicianReferralRecoveryService,
    TechnicianReferralCapturedListener,
    TechnicianReferralOrderStatusListener,
  ],
  exports: [TechnicianReferralsService],
})
export class TechnicianReferralsModule {}
