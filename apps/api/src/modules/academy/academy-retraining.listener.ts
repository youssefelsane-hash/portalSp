import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { returningRows } from '../../common/db/returning-rows';
import { COMPLAINT_STATUS_CHANGED_EVENT, ComplaintStatusChangedEvent } from '../../common/events/complaint-status-changed.event';
import { RATING_SUBMITTED_EVENT, RatingSubmittedEvent } from '../../common/events/rating-submitted.event';
import { NotificationRoutingService } from '../notifications/notification-routing.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RatingType } from '../ratings/entities/rating.entity';
import { SettingsService } from '../settings/settings.service';

const RETRAINING_PROFESSIONALISM_THRESHOLD_FALLBACK = 2;

/**
 * **من «رد فعل بعد الواقعة» لدورة: تدريب ⇒ شغل ⇒ تقييم ⇒ إعادة تدريب** (ADR-0117، docs/08 §189 D-3).
 *
 * شكوى `rude_behavior` اتحلّت بإجراء فعلي (مش `no_action`) أو تقييم احترافية منخفض ⇒ الفني مطلوب منه يعيد
 * الكورس الإلزامي. **مش إيقاف**: الإيقاف يفضل قرار يدوي للحالات الجسيمة. العلامة بتتحط مرة واحدة (مابتتجددش
 * لو موجودة)، وبتتشال لوحدها لما ينجح بعدها (`AcademyService.submitAttempt`).
 *
 * كله fire-and-forget آمن: فشل هنا مايرجّعش حل الشكوى ولا التقييم.
 */
@Injectable()
export class AcademyRetrainingListener {
  private readonly logger = new Logger(AcademyRetrainingListener.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly notificationsService: NotificationsService,
    private readonly routingService: NotificationRoutingService,
  ) {}

  @OnEvent(COMPLAINT_STATUS_CHANGED_EVENT)
  async onComplaintStatusChanged(event: ComplaintStatusChangedEvent): Promise<void> {
    try {
      const [row] = await this.dataSource.query<{ technician_id: string | null }[]>(
        `SELECT COALESCE(against.id, order_tech.id) AS technician_id
           FROM complaints c
           LEFT JOIN technician_profiles against ON against.user_id = c.against_user_id
           LEFT JOIN orders o ON o.id = c.order_id
           LEFT JOIN technician_profiles order_tech ON order_tech.id = o.technician_id
          WHERE c.id = $1
            AND c.complaint_status = 'resolved'
            AND c.category = 'rude_behavior'
            AND c.resolution_type IS NOT NULL
            AND c.resolution_type <> 'no_action'`,
        [event.complaintId],
      );
      if (!row?.technician_id) return;
      await this.markRetrainingRequired(row.technician_id, `شكوى أسلوب مثبتة (${event.complaintNumber})`);
    } catch (err) {
      this.logger.error(`فشل تقييم إعادة التدريب للشكوى ${event.complaintId}`, err instanceof Error ? err.stack : err);
    }
  }

  @OnEvent(RATING_SUBMITTED_EVENT)
  async onRatingSubmitted(event: RatingSubmittedEvent): Promise<void> {
    if (event.ratingType !== RatingType.CUSTOMER_TO_TECHNICIAN) return;
    try {
      const threshold = await this.settingsService.getNumber(
        'academy.retraining_professionalism_threshold',
        RETRAINING_PROFESSIONALISM_THRESHOLD_FALLBACK,
      );
      if (threshold <= 0) return;
      const [row] = await this.dataSource.query<{ technician_id: string; professionalism_rating: number; order_number: string }[]>(
        `SELECT tp.id AS technician_id, r.professionalism_rating, o.order_number
           FROM ratings r
           JOIN technician_profiles tp ON tp.user_id = r.rated_user_id
           LEFT JOIN orders o ON o.id = r.order_id
          WHERE r.id = $1 AND r.professionalism_rating IS NOT NULL AND r.professionalism_rating <= $2`,
        [event.ratingId, threshold],
      );
      if (!row) return;
      await this.markRetrainingRequired(
        row.technician_id,
        `تقييم احترافية ${row.professionalism_rating}/5${row.order_number ? ` على الطلب ${row.order_number}` : ''}`,
      );
    } catch (err) {
      this.logger.error(`فشل تقييم إعادة التدريب للتقييم ${event.ratingId}`, err instanceof Error ? err.stack : err);
    }
  }

  /** مرة واحدة: لو العلامة موجودة أصلاً مابنجددهاش ولا بنبعت تاني. */
  async markRetrainingRequired(technicianId: string, reason: string): Promise<boolean> {
    const raw = await this.dataSource.query<unknown>(
      `UPDATE technician_profiles
          SET retraining_required_at = now(), retraining_reason = $2
        WHERE id = $1 AND retraining_required_at IS NULL AND deleted_at IS NULL
        RETURNING user_id, technician_code`,
      [technicianId, reason.slice(0, 200)],
    );
    const [row] = returningRows<{ user_id: string; technician_code: string }>(raw as never);
    if (!row) return false;
    await this.notificationsService.notify({
      userId: row.user_id,
      notificationType: 'academy_retraining_required',
      titleAr: 'مطلوب منك تعيد كورس «التعامل مع العميل»',
      bodyAr: `السبب: ${reason}. ده مش إيقاف — راجع الدرس القصير وامتحن تاني من الأكاديمية، والعلامة بتتشال أول ما تنجح.`,
      referenceType: 'technician_profile',
      referenceId: technicianId,
      deepLink: '/technician/academy',
    });
    await this.routingService.routeToRole('technician.retraining_required', {
      notificationType: 'technician_retraining_required_ops',
      titleAr: `إعادة تدريب مطلوبة للفني ${row.technician_code}`,
      bodyAr: `${reason}. الفني اتبلّغ يعيد الكورس الإلزامي؛ الإيقاف قرار يدوي لو الحالة جسيمة.`,
      referenceType: 'technician_profile',
      referenceId: technicianId,
      deepLink: `/technicians/${technicianId}`,
    });
    return true;
  }
}
