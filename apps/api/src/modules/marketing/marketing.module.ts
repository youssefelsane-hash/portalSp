import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminMarketingController } from './admin-marketing.controller';
import { MarketingAttribution } from './entities/marketing-attribution.entity';
import { MarketingLinkHit } from './entities/marketing-link-hit.entity';
import { MarketingSource } from './entities/marketing-source.entity';
import { MarketingSourceCommission } from './entities/marketing-source-commission.entity';
import { MarketingLinkController } from './marketing-link.controller';
import { MarketingService } from './marketing.service';
import { MarketingOrderStatusListener } from './listeners/marketing-order-status.listener';
import { MarketingSourceCapturedListener } from './listeners/marketing-source-captured.listener';
import { FirstOrderOfferService } from './first-order-offer.service';
import { FirstOrderOfferListener } from './listeners/first-order-offer.listener';

@Module({
  imports: [
    TypeOrmModule.forFeature([MarketingSource, MarketingLinkHit, MarketingAttribution, MarketingSourceCommission]),
    SettingsModule,
    PromotionsModule,
    NotificationsModule,
  ],
  controllers: [MarketingLinkController, AdminMarketingController],
  providers: [
    MarketingService,
    MarketingOrderStatusListener,
    MarketingSourceCapturedListener,
    FirstOrderOfferService,
    FirstOrderOfferListener,
  ],
  // `AuthModule` بيستهلكها لإسناد المستخدم وقت التسجيل — نفس نمط باقي الموديولات.
  exports: [MarketingService, FirstOrderOfferService],
})
export class MarketingModule {}
