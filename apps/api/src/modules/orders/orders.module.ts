import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { GeoModule } from '../geo/geo.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { STORAGE_SERVICE } from '../../common/storage/storage.service';
import { LocalDiskStorageService } from '../../common/storage/local-disk-storage.service';
import { OrdersController } from './orders.controller';
import { TechnicianOrderExecutionController } from './technician-order-execution.controller';
import { OrdersService } from './orders.service';
import { OrderMediaService } from './order-media.service';
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
  ],
  controllers: [OrdersController, TechnicianOrderExecutionController],
  providers: [
    OrdersService,
    OrderMediaService,
    { provide: STORAGE_SERVICE, useClass: LocalDiskStorageService },
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
