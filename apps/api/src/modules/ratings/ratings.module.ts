import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { Order } from '../orders/entities/order.entity';
import { RatingsController } from './ratings.controller';
import { TechnicianRatingsController } from './technician-ratings.controller';
import { RatingsService } from './ratings.service';
import { Rating } from './entities/rating.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Rating, Order]), CustomersModule, TechniciansModule],
  controllers: [RatingsController, TechnicianRatingsController],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
