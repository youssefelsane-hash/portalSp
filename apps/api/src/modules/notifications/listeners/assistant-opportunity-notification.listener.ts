import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { MoreThan, Repository } from 'typeorm';
import {
  ASSISTANT_OPPORTUNITY_OFFERED_EVENT,
  AssistantOpportunityOfferedEvent,
} from '../../../common/events/assistant-opportunity-offered.event';
import { TechniciansService } from '../../technicians/technicians.service';
import { Notification } from '../entities/notification.entity';
import { NotificationsService } from '../notifications.service';

/**
 * أقل فاصل زمني بين إشعارين من نوع "فرصة مساعدة" لنفس الفني (docs/08 §92، طلب مالك مباشر).
 *
 * بلاغ حقيقي: فني وصله ~20 إشعار "فرصة مساعدة جديدة" في دفعة واحدة — سببها إن
 * `AssistantMatchingRecoveryService` (sweep كل دقيقة) بتعالج لغاية 25 طلب محتاج مساعد في نفس
 * الجولة، وكل طلب مؤهّل بيعمل عرض + إشعار مستقل لكل فني مرشّح — لو نفس الفني قريب/مؤهّل لعدد
 * كبير من الطلبات دي في نفس اللحظة (شائع لو الرصيد قليل)، بياخد كل الإشعارات مرة واحدة بلا أي
 * تباعد. العروض نفسها (order_assistant_offers) شرعية ومحتاجة تتخلق كلها — المشكلة في **الإزعاج**
 * بس، فالحل هنا في طبقة الإشعار: لو الفني أصلاً أخد إشعار "فرصة مساعدة" خلال آخر 5 دقايق، بنسيب
 * العرض يتسجّل عادي (يظهر في قايمة عروض المساعدة جوّه التطبيق) لكن مبنبعتلوش push/in_app زيادة.
 */
const ASSISTANT_OPPORTUNITY_NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;

// مطابقة المساعد التلقائية (ADR-0007) — أولوية 2: عرض بث فردي لمرشّح من مجمع المساعدين،
// أول قبول صحيح ياخد الشريحة.
@Injectable()
export class AssistantOpportunityNotificationListener {
  private readonly logger = new Logger(AssistantOpportunityNotificationListener.name);

  constructor(
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
  ) {}

  @OnEvent(ASSISTANT_OPPORTUNITY_OFFERED_EVENT)
  async handle(event: AssistantOpportunityOfferedEvent): Promise<void> {
    try {
      const candidate = await this.techniciansService.findByProfileIdOrThrow(event.assistantTechnicianId);

      const recentNotification = await this.notifications.findOne({
        where: {
          userId: candidate.userId,
          notificationType: 'assistant_opportunity',
          createdAt: MoreThan(new Date(Date.now() - ASSISTANT_OPPORTUNITY_NOTIFY_COOLDOWN_MS)),
        },
      });
      if (recentNotification) {
        this.logger.log(
          `تخطّي إشعار فرصة مساعدة ${event.offerId} — الفني ${candidate.id} أخد إشعار مماثل خلال آخر 5 دقايق (العرض نفسه اتسجّل عادي)`,
        );
        return;
      }

      await this.notificationsService.notify({
        userId: candidate.userId,
        notificationType: 'assistant_opportunity',
        titleAr: 'فرصة مساعدة جديدة',
        bodyAr: `حد محتاج مساعد على طلب رقم ${event.orderNumber} قريب منك — أول واحد يقبل ياخدها.`,
        referenceType: 'order_assistant_offer',
        referenceId: event.offerId,
        deepLink: `/technician/assistant-offers/${event.offerId}`,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار فرصة مساعدة ${event.offerId}`, err instanceof Error ? err.stack : err);
    }
  }
}
