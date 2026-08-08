import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';
import { DispatchNotificationInput, DispatchResult } from './notification-dispatcher';

/**
 * WhatsApp حقيقي عبر Twilio WhatsApp Business API — نفس حساب Twilio بتاع SMS، بس رقم مُفعّل
 * لـWhatsApp منفصل (TWILIO_WHATSAPP_FROM_NUMBER) وبادئة `whatsapp:` إجبارية في from/to
 * (متطلب رسمي من Twilio API نفسه، مش اختيار تصميم). تفعيلها: docs/03-external-integrations.md.
 */
@Injectable()
export class TwilioWhatsAppDispatcher {
  readonly isConfigured: boolean;
  private readonly logger = new Logger('NotificationDispatch(whatsapp)');
  private readonly client: Twilio | null;
  private readonly fromNumber: string | undefined;

  constructor(config: ConfigService) {
    const accountSid = config.get<string>('notifications.twilio.accountSid');
    const authToken = config.get<string>('notifications.twilio.authToken');
    this.fromNumber = config.get<string>('notifications.twilio.whatsappFromNumber');
    this.isConfigured = Boolean(accountSid && authToken && this.fromNumber);
    this.client = this.isConfigured ? new Twilio(accountSid!, authToken!) : null;
  }

  async send(input: DispatchNotificationInput): Promise<DispatchResult> {
    if (!this.isConfigured || !this.client) {
      return { delivered: false, failureReason: 'لا توجد بوابة WhatsApp مُعدّة (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_WHATSAPP_FROM_NUMBER)' };
    }
    const to = input.targets[0];
    if (!to) {
      return { delivered: false, failureReason: 'لا يوجد رقم هاتف مسجّل لهذا المستخدم' };
    }

    try {
      await this.client.messages.create({
        to: `whatsapp:${to}`,
        from: `whatsapp:${this.fromNumber}`,
        body: `${input.titleAr}\n${input.bodyAr}`,
      });
      return { delivered: true, failureReason: null };
    } catch (err) {
      this.logger.error(`فشل إرسال WhatsApp لـ ${to}`, err instanceof Error ? err.stack : err);
      return { delivered: false, failureReason: err instanceof Error ? err.message : 'خطأ غير معروف في إرسال WhatsApp' };
    }
  }
}
