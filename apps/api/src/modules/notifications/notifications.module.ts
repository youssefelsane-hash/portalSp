import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LogOnlyNotificationDispatcher } from '../../common/notifications/log-only-notification-dispatcher';
import { NOTIFICATION_DISPATCHER } from '../../common/notifications/notification-dispatcher';
import { AuditModule } from '../audit/audit.module';
import { User } from '../auth/entities/user.entity';
import { CustomersModule } from '../customers/customers.module';
import { Order } from '../orders/entities/order.entity';
import { TechniciansModule } from '../technicians/technicians.module';
import { AdminNotificationRoutingController } from './admin-notification-routing.controller';
import { NotificationRoutingRule } from './entities/notification-routing-rule.entity';
import { Notification } from './entities/notification.entity';
import { UserDevice } from './entities/user-device.entity';
import { CashCollectedRoutingListener } from './listeners/cash-collected-routing.listener';
import { ComplaintFiledRoutingListener } from './listeners/complaint-filed-routing.listener';
import { LowRatingRoutingListener } from './listeners/low-rating-routing.listener';
import { OrderAcceptedNotificationListener } from './listeners/order-accepted-notification.listener';
import { OrderCreatedNotificationListener } from './listeners/order-created-notification.listener';
import { OrderReassignedNotificationListener } from './listeners/order-reassigned-notification.listener';
import { OrderStatusNotificationListener } from './listeners/order-status-notification.listener';
import { PayoutCompletedRoutingListener } from './listeners/payout-completed-routing.listener';
import { PayoutRequiresReviewRoutingListener } from './listeners/payout-requires-review-routing.listener';
import { TechnicianVerificationNotificationListener } from './listeners/technician-verification-notification.listener';
import { WelcomeNotificationListener } from './listeners/welcome-notification.listener';
import { NotificationRoutingService } from './notification-routing.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, UserDevice, NotificationRoutingRule, User, Order]),
    CustomersModule,
    TechniciansModule,
    AuditModule,
  ],
  controllers: [NotificationsController, AdminNotificationRoutingController],
  providers: [
    NotificationsService,
    NotificationRoutingService,
    { provide: NOTIFICATION_DISPATCHER, useClass: LogOnlyNotificationDispatcher },
    WelcomeNotificationListener,
    OrderCreatedNotificationListener,
    OrderAcceptedNotificationListener,
    OrderStatusNotificationListener,
    OrderReassignedNotificationListener,
    TechnicianVerificationNotificationListener,
    ComplaintFiledRoutingListener,
    PayoutRequiresReviewRoutingListener,
    CashCollectedRoutingListener,
    PayoutCompletedRoutingListener,
    LowRatingRoutingListener,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
