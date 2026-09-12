import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { SettingsModule } from '../settings/settings.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { Order } from '../orders/entities/order.entity';
import { OrderMedia } from '../orders/entities/order-media.entity';
import { RatingsController } from './ratings.controller';
import { TechnicianRatingsController } from './technician-ratings.controller';
import { RatingsService } from './ratings.service';
import { Rating } from './entities/rating.entity';
import { CustomerRatingEligibilityGuard } from './rating-eligibility.guard';
import { AdminRatingsController } from './admin-ratings.controller';
import { CustomerPendingRatingsController } from './customer-pending-ratings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Rating, Order, OrderMedia]), CustomersModule, TechniciansModule, SettingsModule],
  controllers: [RatingsController, TechnicianRatingsController, CustomerPendingRatingsController, AdminRatingsController],
  providers: [RatingsService, CustomerRatingEligibilityGuard],
  exports: [RatingsService],
})
export class RatingsModule {}
