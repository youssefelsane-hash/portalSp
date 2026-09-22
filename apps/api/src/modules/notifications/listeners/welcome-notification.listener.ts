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
      // **أول رسالة المستخدم بيشوفها في حياته على المنصة** (تدقيق إشعارات 2026-09-21).
      //
      // كانت: «أهلاً بيك في OSTA يا ${fullName}» — فيها تلات مشاكل:
      //   ١) **اسم براند غلط**: المنتج كله اسمه «أسطى» (`legal.platform_name_ar`، وعنوان إشعار
      //      الـOTP في `auth.service.ts`). «OSTA» كانت المكان الوحيد بالإنجليزي — وأول انطباع.
      //   ٢) **الاسم في آخر الجملة**: «في OSTA يا محمد» ترتيب متكلّف؛ العربي الطبيعي بينادي
      //      على الشخص الأول.
      //   ٣) **الاسم ممكن يكون فاضي** (تسجيل برقم بس)، فتطلع «أهلاً بيك في OSTA يا » بمسافة
      //      يتيمة. دلوقتي بيرجع لتحية بلا اسم بدل جملة مكسورة.
      const name = event.fullName?.trim() ?? '';
      const titleAr = name === '' ? 'أهلاً بيك في أسطى' : `أهلاً بيك يا ${name}`;
      await this.notificationsService.notify({
        userId: event.userId,
        notificationType: 'welcome',
        titleAr,
        bodyAr: 'حسابك جاهز. اختار الخدمة اللي محتاجها وإحنا نوصّلك بأقرب صنايعي موثوق.',
      });
    } catch (err) {
      this.logger.error(`فشل إشعار الترحيب للمستخدم ${event.userId}`, err instanceof Error ? err.stack : err);
    }
  }
}
