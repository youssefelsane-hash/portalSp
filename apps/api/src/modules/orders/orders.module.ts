import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { GeoModule } from '../geo/geo.module';
import { PaymentsModule } from '../payments/payments.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { SettingsModule } from '../settings/settings.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { storageServiceProvider } from '../../common/storage/storage.provider';
import { AdminCancellationReasonsController } from './admin-cancellation-reasons.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';
import { CancellationReasonsController } from './cancellation-reasons.controller';
import { CancellationReasonsService } from './cancellation-reasons.service';
import { OrdersController } from './orders.controller';
import { TechnicianOrderExecutionController } from './technician-order-execution.controller';
import { OrdersService } from './orders.service';
import { OrderAutoCancelService } from './order-auto-cancel.service';
import { OrderMediaService } from './order-media.service';
import { OrderTrackingGateway } from './order-tracking.gateway';
import { CancellationReason } from './entities/cancellation-reason.entity';
import { Order } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderMedia } from './entities/order-media.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderStatusHistory, OrderMedia, CancellationReason]),
    CustomersModule,
    CatalogModule,
    GeoModule,
    TechniciansModule,
    PromotionsModule,
    SettingsModule,
    PaymentsModule,
    AuditModule,
    JwtModule.register({}),
  ],
  controllers: [
    OrdersController,
    TechnicianOrderExecutionController,
    AdminOrdersController,
    CancellationReasonsController,
    AdminCancellationReasonsController,
  ],
  providers: [
    OrdersService,
    OrderAutoCancelService,
    OrderMediaService,
    OrderTrackingGateway,
    AdminOrdersService,
    CancellationReasonsService,
    storageServiceProvider,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
