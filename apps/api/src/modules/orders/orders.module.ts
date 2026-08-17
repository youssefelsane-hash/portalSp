import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { BuildingsModule } from '../buildings/buildings.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { GeoModule } from '../geo/geo.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { SettingsModule } from '../settings/settings.module';
import { SupportModule } from '../support/support.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { storageServiceProvider } from '../../common/storage/storage.provider';
import { AdminCancellationReasonsController } from './admin-cancellation-reasons.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';
import { AdminRecurringOrdersController } from './admin-recurring-orders.controller';
import { CancellationReasonsController } from './cancellation-reasons.controller';
import { CancellationReasonsService } from './cancellation-reasons.service';
import { OrdersController } from './orders.controller';
import { TechnicianOrderExecutionController } from './technician-order-execution.controller';
import { RecurringOrdersController } from './recurring-orders.controller';
import { OrdersService } from './orders.service';
import { OrderAutoCancelService } from './order-auto-cancel.service';
import { OrderItemsService } from './order-items.service';
import { OrderMediaService } from './order-media.service';
import { OrderTeamService } from './order-team.service';
import { OrderTrackingGateway } from './order-tracking.gateway';
import { RecurringOrdersService } from './recurring-orders.service';
import { CancellationReason } from './entities/cancellation-reason.entity';
import { Order } from './entities/order.entity';
import { TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderMedia } from './entities/order-media.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';
import { RecurringOrderTemplate } from './entities/recurring-order-template.entity';
import { RealtimeSecurityModule } from '../../common/websocket/realtime-security.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderStatusHistory,
      OrderMedia,
      OrderItem,
      OrderTeamMember,
      RecurringOrderTemplate,
      CancellationReason,
      TechnicianOrderCancellation,
    ]),
    CustomersModule,
    CatalogModule,
    GeoModule,
    TechniciansModule,
    PricingModule,
    PromotionsModule,
    SettingsModule,
    PaymentsModule,
    SupportModule,
    AuditModule,
    BuildingsModule,
    RealtimeSecurityModule,
  ],
  controllers: [
    OrdersController,
    TechnicianOrderExecutionController,
    RecurringOrdersController,
    AdminOrdersController,
    AdminRecurringOrdersController,
    CancellationReasonsController,
    AdminCancellationReasonsController,
  ],
  providers: [
    OrdersService,
    OrderAutoCancelService,
    OrderItemsService,
    OrderMediaService,
    OrderTeamService,
    OrderTrackingGateway,
    RecurringOrdersService,
    AdminOrdersService,
    CancellationReasonsService,
    storageServiceProvider,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
