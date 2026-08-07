import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LogOnlyNotificationDispatcher } from '../../common/notifications/log-only-notification-dispatcher';
import { NOTIFICATION_DISPATCHER } from '../../common/notifications/notification-dispatcher';
import { User } from '../auth/entities/user.entity';
import { CustomersModule } from '../customers/customers.module';
import { Order } from '../orders/entities/order.entity';
import { TechniciansModule } from '../technicians/technicians.module';
import { Notification } from './entities/notification.entity';
import { UserDevice } from './entities/user-device.entity';
import { OrderAcceptedNotificationListener } from './listeners/order-accepted-notification.listener';
import { OrderCreatedNotificationListener } from './listeners/order-created-notification.listener';
import { OrderStatusNotificationListener } from './listeners/order-status-notification.listener';
import { TechnicianVerificationNotificationListener } from './listeners/technician-verification-notification.listener';
import { WelcomeNotificationListener } from './listeners/welcome-notification.listener';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, UserDevice, User, Order]),
    CustomersModule,
    TechniciansModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    { provide: NOTIFICATION_DISPATCHER, useClass: LogOnlyNotificationDispatcher },
    WelcomeNotificationListener,
    OrderCreatedNotificationListener,
    OrderAcceptedNotificationListener,
    OrderStatusNotificationListener,
    TechnicianVerificationNotificationListener,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
