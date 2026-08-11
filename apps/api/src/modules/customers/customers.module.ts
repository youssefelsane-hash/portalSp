import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GeoModule } from '../geo/geo.module';
import { Order } from '../orders/entities/order.entity';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';
import { CustomerProfileListener } from './customer-profile.listener';
import { CustomerProfilesService } from './customer-profiles.service';
import { CustomerStatsProcessor } from './customer-stats.processor';
import { CUSTOMER_STATS_QUEUE } from './customer-stats.queue';
import { CustomerStatsRecalculationListener } from './customer-stats-recalculation.listener';
import { CustomerStatsService } from './customer-stats.service';
import { Address } from './entities/address.entity';
import { CustomerProfile } from './entities/customer-profile.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Address, CustomerProfile, Order]),
    GeoModule,
    BullModule.registerQueue({ name: CUSTOMER_STATS_QUEUE }),
  ],
  controllers: [AddressesController],
  providers: [
    AddressesService,
    CustomerProfileListener,
    CustomerProfilesService,
    CustomerStatsService,
    CustomerStatsProcessor,
    CustomerStatsRecalculationListener,
  ],
  exports: [AddressesService, CustomerProfilesService, CustomerStatsService],
})
export class CustomersModule {}
