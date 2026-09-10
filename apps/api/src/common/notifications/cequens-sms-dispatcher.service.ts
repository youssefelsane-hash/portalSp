import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DispatchNotificationInput, DispatchResult } from './notification-dispatcher';
import { SmsDispatcher } from './sms-dispatcher';

/** مهلة أي نداء للمزوّد — من غيرها سوكيت متعلّق بيوقف مسار تسجيل الدخول كله. */
const REQUEST_TIMEOUT_MS = 15_000;
/** هامش أمان قبل انتهاء التوكن — بنجدّده قبل ما يقع بدل ما نكتشف بفشل إرسال. */
const TOKEN_REFRESH_SKEW_SECONDS = 60;

interface CequensTokenResponse {
  access_token?: string;
  expires_in?: number;
}

/**
 * **SMS عبر CEQUENS** (المزوّد المصري المعتمد لإطلاق Osta).
 *
 * ### المصادقة — الشكلين اللي CEQUENS بيدعمهم
 *
 * 1. **مفتاح API جاهز** (`CEQUENS_API_KEY`): بيتولّد من لوحة CEQUENS (Developers → Create API
 *    Key) وبيتبعت مباشرةً كـ`Authorization: Bearer <key>`. ده أبسط وأقل حركة، ومفضّل للسيرفر.
 * 2. **تبادل OAuth2** (`CEQUENS_CLIENT_ID`/`CEQUENS_CLIENT_SECRET`/`CEQUENS_USERNAME`/
 *    `CEQUENS_PASSWORD`): نداء `POST {authUrl}` بـ`grant_type=password` بيرجّع `access_token`
 *    بصلاحية محدودة، وبيتخزّن في الذاكرة ويتجدّد قبل انتهائه.
 *
 * المفتاح الجاهز بياخد الأولوية لو موجود. الاتنين بيوصلوا لنفس نقطة الإرسال:
 * `POST {baseUrl}/messages` بجسم `{senderName, messageType, messageText, recipients}`.
 *
 * ⚠️ **التحقق النهائي من عقد المصادقة لسه محتاج حساب حقيقي**: توثيق CEQUENS العام بيوصف
 * المسارين، والحساب هو اللي بيحدد أنهي واحد مفعّل. عشان كده الاتنين مدعومين هنا بدل ما نراهن
 * على واحد ونكتشف غلط وقت الإطلاق. الأسماء والمسارات كلها قابلة للتهيئة من البيئة
 * (`CEQUENS_BASE_URL`/`CEQUENS_AUTH_URL`) فأي فرق في الحساب بيتظبط بلا تعديل كود.
 *
 * **ممنوع تسجيل أي سر أو أي كود OTP** — اللوج بياخد سبب الفشل ورقم مقصوص بس.
 */
@Injectable()
export class CequensSmsDispatcher implements SmsDispatcher {
  readonly isConfigured: boolean;
  readonly providerName = 'cequens';
  private readonly logger = new Logger('NotificationDispatch(sms:cequens)');

  private readonly baseUrl: string;
  private readonly authUrl: string;
  private readonly apiKey?: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly senderName?: string;

  /** توكن OAuth المخزّن في الذاكرة — مابيتكتبش في أي لوج ولا قاعدة. */
  private cachedToken: { value: string; expiresAtMs: number } | null = null;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('notifications.cequens.baseUrl') ?? 'https://apis.cequens.com/sms/v1';
    this.authUrl = config.get<string>('notifications.cequens.authUrl') ?? 'https://apis.cequens.com/auth/v1/tokens';
    this.apiKey = config.get<string>('notifications.cequens.apiKey');
    this.clientId = config.get<string>('notifications.cequens.clientId');
    this.clientSecret = config.get<string>('notifications.cequens.clientSecret');
    this.username = config.get<string>('notifications.cequens.username');
    this.password = config.get<string>('notifications.cequens.password');
    this.senderName = config.get<string>('notifications.cequens.senderName');

    const hasCredentials = Boolean(this.apiKey) || Boolean(this.clientId && this.clientSecret && this.username && this.password);
    // اسم المُرسِل (Sender ID) إجباري: CEQUENS بيرفض الرسالة من غيره، ولازم يكون معتمد للدولة.
    this.isConfigured = hasCredentials && Boolean(this.senderName);
  }

  async send(input: DispatchNotificationInput): Promise<DispatchResult> {
    if (!this.isConfigured) {
      return {
        delivered: false,
        failureReason: 'بوابة CEQUENS مش مُعدّة (CEQUENS_API_KEY أو بيانات OAuth + CEQUENS_SENDER_NAME)',
      };
    }
    const to = input.targets[0];
    if (!to) {
      return { delivered: false, failureReason: 'لا يوجد رقم هاتف مسجّل لهذا المستخدم' };
    }

    try {
      const token = await this.resolveToken();
      const response = await this.fetchWithTimeout(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          senderName: this.senderName,
          messageType: 'text',
          messageText: `${input.titleAr}\n${input.bodyAr}`,
          // E.164 إجباري — نفس الشكل اللي `normalizePhoneNumber` بيطلّعه في التسجيل.
          recipients: to,
        }),
      });

      if (!response.ok) {
        // نص الرد مفيد للتشخيص ومفيهوش أسرارنا (بيوصف الرفض)، بس بنقصّه عشان مايغرقش اللوج.
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        this.logger.error(`CEQUENS رفض الإرسال لـ${maskPhone(to)} — HTTP ${response.status}: ${detail}`);
        return { delivered: false, failureReason: `فشل إرسال SMS عبر CEQUENS (HTTP ${response.status})` };
      }
      return { delivered: true, failureReason: null };
    } catch (err) {
      this.logger.error(`فشل إرسال SMS لـ${maskPhone(to)}`, err instanceof Error ? err.stack : undefined);
      return { delivered: false, failureReason: err instanceof Error ? err.message : 'خطأ غير معروف في إرسال SMS' };
    }
  }

  /** المفتاح الجاهز لو موجود، وإلا توكن OAuth محفوظ في الذاكرة ومتجدّد قبل انتهائه. */
  private async resolveToken(): Promise<string> {
    if (this.apiKey) return this.apiKey;
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs > now) return this.cachedToken.value;

    const response = await this.fetchWithTimeout(this.authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'password',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        username: this.username,
        password: this.password,
      }),
    });
    if (!response.ok) {
      // **من غير ما نطبع أي بيانات اعتماد** — الحالة والرسالة بس.
      throw new Error(`فشل الحصول على توكن CEQUENS (HTTP ${response.status})`);
    }
    const body = (await response.json()) as CequensTokenResponse;
    if (!body.access_token) {
      throw new Error('رد توكن CEQUENS مفيهوش access_token');
    }
    const ttlSeconds = Math.max(60, (body.expires_in ?? 3600) - TOKEN_REFRESH_SKEW_SECONDS);
    this.cachedToken = { value: body.access_token, expiresAtMs: now + ttlSeconds * 1000 };
    return body.access_token;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** رقم مقصوص للّوج — التشخيص محتاج يفرّق بين الأرقام، مش يخزّنها كاملة. */
function maskPhone(phone: string): string {
  return phone.length <= 4 ? '***' : `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}
