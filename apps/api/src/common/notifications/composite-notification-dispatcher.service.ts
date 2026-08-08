import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../../modules/notifications/entities/notification.entity';
import { FcmPushDispatcher } from './fcm-push-dispatcher.service';
import { LogOnlyNotificationDispatcher } from './log-only-notification-dispatcher';
import { DispatchNotificationInput, DispatchResult, NotificationDispatcher } from './notification-dispatcher';
import { SmtpEmailDispatcher } from './smtp-email-dispatcher.service';
import { TwilioSmsDispatcher } from './twilio-sms-dispatcher.service';
import { TwilioWhatsAppDispatcher } from './twilio-whatsapp-dispatcher.service';

/**
 * بيوجّه كل قناة لبوابتها الحقيقية (FCM/Twilio SMS/Twilio WhatsApp/SMTP) — قناة مش مُعدّة
 * (`isConfigured=false`) بترجع لـ LogOnlyNotificationDispatcher بدل ما ترفض بصمت أو تنهار، نفس
 * فلسفة PaymentGateway/StorageService بالظبط: كل قناة مستقلة، تفعيل قناة واحدة (زي push بس)
 * مايأثرش على الباقي (لسه log-only لحد ما تتظبط هي كمان). in_app دايماً "delivered" فوراً —
 * بيتخزن في القاعدة نفسها (Notification entity)، مفيش بوابة خارجية له أصلاً.
 */
@Injectable()
export class CompositeNotificationDispatcher implements NotificationDispatcher {
  constructor(
    private readonly push: FcmPushDispatcher,
    private readonly sms: TwilioSmsDispatcher,
    private readonly whatsapp: TwilioWhatsAppDispatcher,
    private readonly email: SmtpEmailDispatcher,
    private readonly logOnly: LogOnlyNotificationDispatcher,
  ) {}

  async dispatch(input: DispatchNotificationInput): Promise<DispatchResult> {
    switch (input.channel) {
      case NotificationChannel.IN_APP:
        return this.logOnly.dispatch(input);
      case NotificationChannel.PUSH:
        return this.push.isConfigured ? this.push.send(input) : this.logOnly.dispatch(input);
      case NotificationChannel.SMS:
        return this.sms.isConfigured ? this.sms.send(input) : this.logOnly.dispatch(input);
      case NotificationChannel.WHATSAPP:
        return this.whatsapp.isConfigured ? this.whatsapp.send(input) : this.logOnly.dispatch(input);
      case NotificationChannel.EMAIL:
        return this.email.isConfigured ? this.email.send(input) : this.logOnly.dispatch(input);
      default:
        return this.logOnly.dispatch(input);
    }
  }
}
