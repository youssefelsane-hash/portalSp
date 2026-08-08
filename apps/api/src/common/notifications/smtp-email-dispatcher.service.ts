import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { DispatchNotificationInput, DispatchResult } from './notification-dispatcher';

/**
 * بريد إلكتروني حقيقي عبر SMTP — يشتغل مع أي بوابة (SendGrid، Mailgun، Amazon SES، أو حتى Gmail
 * SMTP للتطوير) لأن SMTP بروتوكول موحّد، مش SDK مقفول على بوابة واحدة. تفعيلها = ملء
 * SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_FROM_EMAIL في .env (تفاصيل الحصول على كل
 * قيمة من أي بوابة SMTP اخترتها: docs/03-external-integrations.md).
 */
@Injectable()
export class SmtpEmailDispatcher {
  readonly isConfigured: boolean;
  private readonly logger = new Logger('NotificationDispatch(email)');
  private readonly transporter: Transporter | null;
  private readonly fromAddress: string | undefined;

  constructor(config: ConfigService) {
    const host = config.get<string>('notifications.smtp.host');
    const port = config.get<number>('notifications.smtp.port');
    const user = config.get<string>('notifications.smtp.user');
    const password = config.get<string>('notifications.smtp.password');
    this.fromAddress = config.get<string>('notifications.smtp.fromEmail');
    this.isConfigured = Boolean(host && port && user && password && this.fromAddress);

    this.transporter = this.isConfigured
      ? createTransport({
          host,
          port,
          secure: config.get<boolean>('notifications.smtp.secure') ?? port === 465,
          auth: { user, pass: password },
        })
      : null;
  }

  async send(input: DispatchNotificationInput): Promise<DispatchResult> {
    if (!this.isConfigured || !this.transporter) {
      return { delivered: false, failureReason: 'لا توجد بوابة بريد مُعدّة (SMTP_HOST/SMTP_USER/SMTP_PASSWORD/SMTP_FROM_EMAIL)' };
    }
    const to = input.targets[0];
    if (!to) {
      return { delivered: false, failureReason: 'لا يوجد بريد إلكتروني مسجّل لهذا المستخدم' };
    }

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to,
        subject: input.titleAr,
        text: input.bodyAr,
        html: `<p>${input.bodyAr}</p>${input.deepLink ? `<p><a href="${input.deepLink}">فتح في التطبيق</a></p>` : ''}`,
      });
      return { delivered: true, failureReason: null };
    } catch (err) {
      this.logger.error(`فشل إرسال بريد لـ ${to}`, err instanceof Error ? err.stack : err);
      return { delivered: false, failureReason: err instanceof Error ? err.message : 'خطأ غير معروف في إرسال البريد' };
    }
  }
}
