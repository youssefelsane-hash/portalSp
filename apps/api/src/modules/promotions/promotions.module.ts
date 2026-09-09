import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { User } from '../auth/entities/user.entity';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { GeoModule } from '../geo/geo.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminPromotionsController } from './admin-promotions.controller';
import { LoyaltyTransaction } from './entities/loyalty-transaction.entity';
import { PromoCode } from './entities/promo-code.entity';
import { PromoCodeLinkAttribution } from './entities/promo-code-link-attribution.entity';
import { PromoCodeLinkHit } from './entities/promo-code-link-hit.entity';
import { PromoCodeMarketingCommission } from './entities/promo-code-marketing-commission.entity';
import { PromoCodeUsage } from './entities/promo-code-usage.entity';
import { LoyaltyExpiryService } from './loyalty-expiry.service';
import { LoyaltyService } from './loyalty.service';
import { PromoCodesService } from './promo-codes.service';
import { PromoCodeLinkController } from './promo-code-link.controller';
import { PromoCodeLinksService } from './promo-code-links.service';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';
import { PromoLinkCapturedListener } from './listeners/promo-link-captured.listener';
import { PromoMarketingOrderStatusListener } from './listeners/promo-marketing-order-status.listener';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PromoCode,
      PromoCodeUsage,
      PromoCodeLinkHit,
      PromoCodeLinkAttribution,
      PromoCodeMarketingCommission,
      LoyaltyTransaction,
      CustomerProfile,
      User,
    ]),
    CustomersModule,
    CatalogModule,
    GeoModule,
    AuditModule,
    SettingsModule,
    NotificationsModule,
  ],
  controllers: [PromotionsController, AdminPromotionsController, PromoCodeLinkController],
  providers: [
    PromoCodesService,
    PromoCodeLinksService,
    PromoLinkCapturedListener,
    PromoMarketingOrderStatusListener,
    LoyaltyService,
    LoyaltyExpiryService,
    PromotionsService,
  ],
  exports: [PromoCodesService, PromoCodeLinksService, LoyaltyService, LoyaltyExpiryService],
})
export class PromotionsModule {}
