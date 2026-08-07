import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { GeoModule } from '../geo/geo.module';
import { AdminPromotionsController } from './admin-promotions.controller';
import { LoyaltyTransaction } from './entities/loyalty-transaction.entity';
import { PromoCode } from './entities/promo-code.entity';
import { PromoCodeUsage } from './entities/promo-code-usage.entity';
import { LoyaltyService } from './loyalty.service';
import { PromoCodesService } from './promo-codes.service';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PromoCode, PromoCodeUsage, LoyaltyTransaction, CustomerProfile, User]),
    CustomersModule,
    CatalogModule,
    GeoModule,
  ],
  controllers: [PromotionsController, AdminPromotionsController],
  providers: [PromoCodesService, LoyaltyService, PromotionsService],
  exports: [PromoCodesService],
})
export class PromotionsModule {}
