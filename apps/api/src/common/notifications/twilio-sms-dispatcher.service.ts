import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';
import { DispatchNotificationInput, DispatchResult } from './notification-dispatcher';
import { SmsDispatcher } from './sms-dispatcher';

/**
 * SMS حقيقي عبر Twilio — تفعيلها = ملء TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_SMS_FROM_NUMBER
 * في .env (تفاصيل الحصول عليهم: docs/03-external-integrations.md) من غير أي تعديل كود.
 *
 * بقى **بديل احتياطي** بعد هجرة 2026-09-10 لـCEQUENS كمزوّد أساسي لمصر؛ الاختيار بينهم في
 * `sms-dispatcher.provider.ts` عبر `SMS_PROVIDER`، والمستهلك بيحقن `SMS_DISPATCHER` مش الكلاس ده.
 */
@Injectable()
export class TwilioSmsDispatcher implements SmsDispatcher {
  readonly isConfigured: boolean;
  readonly providerName = 'twilio';
  private readonly logger = new Logger('NotificationDispatch(sms)');
  private readonly client: Twilio | null;
  private readonly fromNumber: string | undefined;

  constructor(config: ConfigService) {
    const accountSid = config.get<string>('notifications.twilio.accountSid');
    const authToken = config.get<string>('notifications.twilio.authToken');
    this.fromNumber = config.get<string>('notifications.twilio.smsFromNumber');
    this.isConfigured = Boolean(accountSid && authToken && this.fromNumber);
    this.client = this.isConfigured ? new Twilio(accountSid!, authToken!) : null;
  }

  async send(input: DispatchNotificationInput): Promise<DispatchResult> {
    if (!this.isConfigured || !this.client) {
      return { delivered: false, failureReason: 'لا توجد بوابة SMS مُعدّة (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_SMS_FROM_NUMBER)' };
    }
    const to = input.targets[0];
    if (!to) {
      return { delivered: false, failureReason: 'لا يوجد رقم هاتف مسجّل لهذا المستخدم' };
    }

    try {
      await this.client.messages.create({
        to,
        from: this.fromNumber,
        body: `${input.titleAr}\n${input.bodyAr}`,
      });
      return { delivered: true, failureReason: null };
    } catch (err) {
      this.logger.error(`فشل إرسال SMS لـ ${to}`, err instanceof Error ? err.stack : err);
      return { delivered: false, failureReason: err instanceof Error ? err.message : 'خطأ غير معروف في إرسال SMS' };
    }
  }
}
