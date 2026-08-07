import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { USER_REGISTERED_EVENT, UserRegisteredEvent } from '../../../common/events/user-registered.event';
import { NotificationsService } from '../notifications.service';

@Injectable()
export class WelcomeNotificationListener {
  private readonly logger = new Logger(WelcomeNotificationListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(USER_REGISTERED_EVENT)
  async handleUserRegistered(event: UserRegisteredEvent): Promise<void> {
    try {
      await this.notificationsService.notify({
        userId: event.userId,
        notificationType: 'welcome',
        titleAr: `أهلاً بيك في BAYTAK يا ${event.fullName}`,
        bodyAr: 'حسابك اتعمل بنجاح. جاهز تطلب أول خدمة؟',
      });
    } catch (err) {
      this.logger.error(`فشل إشعار الترحيب للمستخدم ${event.userId}`, err instanceof Error ? err.stack : err);
    }
  }
}
