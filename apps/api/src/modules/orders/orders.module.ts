import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { GeoModule } from '../geo/geo.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { STORAGE_SERVICE } from '../../common/storage/storage.service';
import { LocalDiskStorageService } from '../../common/storage/local-disk-storage.service';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';
import { OrdersController } from './orders.controller';
import { TechnicianOrderExecutionController } from './technician-order-execution.controller';
import { OrdersService } from './orders.service';
import { OrderMediaService } from './order-media.service';
import { OrderTrackingGateway } from './order-tracking.gateway';
import { Order } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderMedia } from './entities/order-media.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderStatusHistory, OrderMedia]),
    CustomersModule,
    CatalogModule,
    GeoModule,
    TechniciansModule,
    PromotionsModule,
    AuditModule,
    JwtModule.register({}),
  ],
  controllers: [OrdersController, TechnicianOrderExecutionController, AdminOrdersController],
  providers: [
    OrdersService,
    OrderMediaService,
    OrderTrackingGateway,
    AdminOrdersService,
    { provide: STORAGE_SERVICE, useClass: LocalDiskStorageService },
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
