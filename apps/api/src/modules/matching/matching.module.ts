import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersModule } from '../orders/orders.module';
import { SettingsModule } from '../settings/settings.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { Order } from '../orders/entities/order.entity';
import { MatchingRoundExpiryProcessor } from './matching-round-expiry.processor';
import { MATCHING_ROUNDS_QUEUE } from './matching-rounds.queue';
import { MatchingService } from './matching.service';
import { OrderDispatchListener } from './order-dispatch.listener';
import { TechnicianOrdersController } from './technician-orders.controller';
import { OrderAssignment } from './entities/order-assignment.entity';

@Module({
  // Order مضاف هنا كمان (بجانب OrdersModule) عشان matching محتاج transaction واحدة تلمس
  // order_assignments و orders و order_status_history مع بعض ذرّياً — تنسيقها عبر خدمتين
  // منفصلتين كان هيكسر الذرّية اللي بتمنع التعيين المزدوج.
  // BullModule.forRootAsync مسجّل مرة واحدة في AppModule — هنا بس registerQueue.
  imports: [
    TypeOrmModule.forFeature([OrderAssignment, Order]),
    OrdersModule,
    TechniciansModule,
    SettingsModule,
    BullModule.registerQueue({ name: MATCHING_ROUNDS_QUEUE }),
  ],
  controllers: [TechnicianOrdersController],
  providers: [MatchingService, OrderDispatchListener, MatchingRoundExpiryProcessor],
  exports: [MatchingService],
})
export class MatchingModule {}
