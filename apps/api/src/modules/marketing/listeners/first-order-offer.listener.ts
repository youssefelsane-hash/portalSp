import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { USER_REGISTERED_EVENT, UserRegisteredEvent } from '../../../common/events/user-registered.event';
import { UserType } from '../../auth/entities/user.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { FirstOrderOfferService } from '../first-order-offer.service';

/**
 * إصدار كود «خصم أول طلب» عند تسجيل عميل جديد + إشعاره بيه (docs/08 §135-و).
 *
 * الحدث ده بيتطلق بعد commit التسجيل، فالكود بيتصدر خارج ترانزاكشن إنشاء المستخدم عن قصد:
 * أي عطل في العرض الترويجي **مايوقفش تسجيل عميل**. لو الإصدار فشل، العميل يفضل مسجّل بلا كود
 * والأدمن يقدر يصدره يدويًا من `/promotions` — بالظبط زي أي كود شخصي تاني.
 */
@Injectable()
export class FirstOrderOfferListener {
  private readonly logger = new Logger(FirstOrderOfferListener.name);

  constructor(
    private readonly firstOrderOffer: FirstOrderOfferService,
    private readonly notifications: NotificationsService,
  ) {}

  @OnEvent(USER_REGISTERED_EVENT)
  async handle(event: UserRegisteredEvent): Promise<void> {
    if (event.userType !== UserType.CUSTOMER) return;
    try {
      const offer = await this.firstOrderOffer.issueForCustomer(event.userId);
      if (!offer) return;
      await this.notifications.notify({
        userId: event.userId,
        notificationType: 'first_order_offer',
        titleAr: 'هدية أول طلب 🎁',
        bodyAr: `${offer.messageAr} استخدم كود "${offer.code}".`,
      });
    } catch (err) {
      this.logger.error(
        `تعذّر إصدار عرض أول طلب للمستخدم ${event.userId} — التسجيل نفسه مالوش أي تأثر`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
