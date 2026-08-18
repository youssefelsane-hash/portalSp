import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SecurityEventCreatedEvent, SECURITY_EVENT_CREATED_EVENT } from '../../../common/events/security-event-created.event';
import { NotificationRoutingService } from '../notification-routing.service';

// Script 5 Part 6 — تنبيهات Super Admin اللحظية للأحداث الأمنية. نفس نمط
// emergency-order-routing.listener.ts بالحرف — صفر قناة إشعارات جديدة، صف توجيه جديد بس
// (migration 0137: security.critical_event → super_admin) في notification_routing_rules الموجودة.
// بيتطلق أول مرة الحدث يتخلق بس (SecurityEventsService.recordDenial) — مش على كل تجميع/dedup.
const SEVERITY_LABELS_AR: Record<string, string> = {
  info: 'معلومة',
  warning: 'تحذير',
  high: 'خطورة عالية',
  critical: 'حرج',
};

const EVENT_TYPE_LABELS_AR: Record<string, string> = {
  privilege_escalation_attempt: 'محاولة تصعيد صلاحيات',
  unauthorized_role_change: 'محاولة تغيير دور غير مصرّح بيها',
  unauthorized_permission_grant: 'محاولة منح صلاحية غير مصرّح بيها',
  repeated_permission_denial: 'رفض متكرر لفعل حساس',
  mfa_failure_burst: 'محاولات MFA فاشلة متكررة',
  sensitive_action_denied: 'فعل حساس اترفض',
  session_reuse_after_revoke: 'محاولة استخدام جلسة ملغاة',
  blocked_account_access_attempt: 'محاولة وصول من حساب محظور',
  security_setting_change: 'تغيير إعداد أمني',
};

@Injectable()
export class SecurityEventRoutingListener {
  private readonly logger = new Logger(SecurityEventRoutingListener.name);

  constructor(private readonly routingService: NotificationRoutingService) {}

  @OnEvent(SECURITY_EVENT_CREATED_EVENT)
  async handleSecurityEventCreated(event: SecurityEventCreatedEvent): Promise<void> {
    try {
      // INFO/WARNING عادي (مثلاً رفض 403 عادي لأدمن بيحاول يفتح صفحة مالوش صلاحية ليها) —
      // Part 5 §11 صراحة: مش كل رفض محتاج تنبيه. HIGH/CRITICAL بس بيوصل لـSuper Admin.
      if (event.severity !== 'high' && event.severity !== 'critical') return;

      await this.routingService.routeToRole('security.critical_event', {
        notificationType: 'security_critical_event',
        titleAr: `تنبيه أمني (${SEVERITY_LABELS_AR[event.severity] ?? event.severity}): ${EVENT_TYPE_LABELS_AR[event.eventType] ?? event.eventType}`,
        bodyAr: 'حدث أمني محتاج مراجعة — افتح مركز الأمان لتفاصيل الفاعل والإجراء المحاول.',
        referenceType: 'security_event',
        referenceId: event.securityEventId,
        deepLink: `/security/alerts/${event.securityEventId}`,
      });
    } catch (err) {
      this.logger.error(`فشل توجيه تنبيه الحدث الأمني ${event.securityEventId}`, err instanceof Error ? err.stack : err);
    }
  }
}
