import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompositeNotificationDispatcher } from '../../common/notifications/composite-notification-dispatcher.service';
import { FcmPushDispatcher } from '../../common/notifications/fcm-push-dispatcher.service';
import { LogOnlyNotificationDispatcher } from '../../common/notifications/log-only-notification-dispatcher';
import { NOTIFICATION_DISPATCHER } from '../../common/notifications/notification-dispatcher';
import { SmtpEmailDispatcher } from '../../common/notifications/smtp-email-dispatcher.service';
import { TwilioSmsDispatcher } from '../../common/notifications/twilio-sms-dispatcher.service';
import { TwilioWhatsAppDispatcher } from '../../common/notifications/twilio-whatsapp-dispatcher.service';
import { AuditModule } from '../audit/audit.module';
import { User } from '../auth/entities/user.entity';
import { CustomersModule } from '../customers/customers.module';
import { Order } from '../orders/entities/order.entity';
import { SettingsModule } from '../settings/settings.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { AdminNotificationRoutingController } from './admin-notification-routing.controller';
import { AdminNotificationTypeConfigsController } from './admin-notification-type-configs.controller';
import { NotificationRoutingRule } from './entities/notification-routing-rule.entity';
import { NotificationTypeConfig } from './entities/notification-type-config.entity';
import { NotificationWorkflow } from './entities/notification-workflow.entity';
import { Notification } from './entities/notification.entity';
import { UserDevice } from './entities/user-device.entity';
import { UserNotificationPreference } from './entities/user-notification-preference.entity';
import { AssistantMatchingEscalatedRoutingListener } from './listeners/assistant-matching-escalated-routing.listener';
import { AssistantOpportunityNotificationListener } from './listeners/assistant-opportunity-notification.listener';
import { AssistantPersonalAssignedNotificationListener } from './listeners/assistant-personal-assigned-notification.listener';
import { CashCollectedRoutingListener } from './listeners/cash-collected-routing.listener';
import { ComplaintFiledRoutingListener } from './listeners/complaint-filed-routing.listener';
import { SupportChatMessageRoutingListener } from './listeners/support-chat-message-routing.listener';
import { EmergencyDispatchStrugglingRoutingListener } from './listeners/emergency-dispatch-struggling-routing.listener';
import { OrderNoTechnicianFoundRoutingListener } from './listeners/order-no-technician-found-routing.listener';
import { PaymentInstaPayRejectedNotificationListener } from './listeners/payment-instapay-rejected-notification.listener';
import { EmergencyOrderRoutingListener } from './listeners/emergency-order-routing.listener';
import { LowRatingRoutingListener } from './listeners/low-rating-routing.listener';
import { OrderAcceptedNotificationListener } from './listeners/order-accepted-notification.listener';
import { OrderAssistantAssignedManuallyNotificationListener } from './listeners/order-assistant-assigned-manually-notification.listener';
import { OrderCreatedNotificationListener } from './listeners/order-created-notification.listener';
import { OrderOfferNotificationListener } from './listeners/order-offer-notification.listener';
import { OrderOfferResolutionListener } from './listeners/order-offer-resolution.listener';
import { OrderReassignedNotificationListener } from './listeners/order-reassigned-notification.listener';
import { OrderRescheduledNotificationListener } from './listeners/order-rescheduled-notification.listener';
import { OrderStatusNotificationListener } from './listeners/order-status-notification.listener';
import { PayoutCompletedRoutingListener } from './listeners/payout-completed-routing.listener';
import { PayoutRequiresReviewRoutingListener } from './listeners/payout-requires-review-routing.listener';
import { RatingSubmittedNotificationListener } from './listeners/rating-submitted-notification.listener';
import { RecurringTemplateGenerationFailingRoutingListener } from './listeners/recurring-template-generation-failing-routing.listener';
import { ReferralRewardNotificationListener } from './listeners/referral-reward-notification.listener';
import { SecurityEventRoutingListener } from './listeners/security-event-routing.listener';
import { TechnicianCancellationNotificationListener } from './listeners/technician-cancellation-notification.listener';
import { OrderCrewChangedNotificationListener } from './listeners/order-crew-changed-notification.listener';
import { TechnicianServiceVerificationNotificationListener } from './listeners/technician-service-verification-notification.listener';
import { TechnicianCategoryVerificationNotificationListener } from './listeners/technician-category-verification-notification.listener';
import { TechnicianVerificationNotificationListener } from './listeners/technician-verification-notification.listener';
import { WelcomeNotificationListener } from './listeners/welcome-notification.listener';
import { NotificationRoutingService } from './notification-routing.service';
import { NotificationTypeConfigService } from './notification-type-config.service';
import { NotificationWorkflowReminderService } from './notification-workflow-reminder.service';
import { NotificationWorkflowService } from './notification-workflow.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      UserDevice,
      NotificationRoutingRule,
      UserNotificationPreference,
      NotificationTypeConfig,
      NotificationWorkflow,
      User,
      Order,
    ]),
    CustomersModule,
    TechniciansModule,
    SettingsModule,
    AuditModule,
  ],
  controllers: [NotificationsController, AdminNotificationRoutingController, AdminNotificationTypeConfigsController],
  providers: [
    NotificationsService,
    NotificationRoutingService,
    NotificationTypeConfigService,
    NotificationWorkflowService,
    NotificationWorkflowReminderService,
    LogOnlyNotificationDispatcher,
    FcmPushDispatcher,
    TwilioSmsDispatcher,
    TwilioWhatsAppDispatcher,
    SmtpEmailDispatcher,
    { provide: NOTIFICATION_DISPATCHER, useClass: CompositeNotificationDispatcher },
    WelcomeNotificationListener,
    OrderCreatedNotificationListener,
    OrderAcceptedNotificationListener,
    OrderStatusNotificationListener,
    OrderReassignedNotificationListener,
    OrderRescheduledNotificationListener,
    TechnicianVerificationNotificationListener,
    TechnicianServiceVerificationNotificationListener,
    TechnicianCategoryVerificationNotificationListener,
    OrderCrewChangedNotificationListener,
    ComplaintFiledRoutingListener,
    SupportChatMessageRoutingListener,
    EmergencyOrderRoutingListener,
    PayoutRequiresReviewRoutingListener,
    CashCollectedRoutingListener,
    PayoutCompletedRoutingListener,
    LowRatingRoutingListener,
    RatingSubmittedNotificationListener,
    SecurityEventRoutingListener,
    RecurringTemplateGenerationFailingRoutingListener,
    ReferralRewardNotificationListener,
    AssistantPersonalAssignedNotificationListener,
    AssistantOpportunityNotificationListener,
    AssistantMatchingEscalatedRoutingListener,
    TechnicianCancellationNotificationListener,
    OrderAssistantAssignedManuallyNotificationListener,
    OrderOfferNotificationListener,
    OrderOfferResolutionListener,
    EmergencyDispatchStrugglingRoutingListener,
    OrderNoTechnicianFoundRoutingListener,
    PaymentInstaPayRejectedNotificationListener,
  ],
  exports: [NotificationsService, NotificationWorkflowService, NotificationRoutingService],
})
export class NotificationsModule {}
