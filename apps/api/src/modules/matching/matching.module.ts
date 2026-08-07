import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersModule } from '../orders/orders.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { Order } from '../orders/entities/order.entity';
import { MatchingService } from './matching.service';
import { OrderDispatchListener } from './order-dispatch.listener';
import { TechnicianOrdersController } from './technician-orders.controller';
import { OrderAssignment } from './entities/order-assignment.entity';

@Module({
  // Order مضاف هنا كمان (بجانب OrdersModule) عشان matching محتاج transaction واحدة تلمس
  // order_assignments و orders و order_status_history مع بعض ذرّياً — تنسيقها عبر خدمتين
  // منفصلتين كان هيكسر الذرّية اللي بتمنع التعيين المزدوج.
  imports: [TypeOrmModule.forFeature([OrderAssignment, Order]), OrdersModule, TechniciansModule],
  controllers: [TechnicianOrdersController],
  providers: [MatchingService, OrderDispatchListener],
  exports: [MatchingService],
})
export class MatchingModule {}
