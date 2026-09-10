import { DispatchNotificationInput, DispatchResult } from './notification-dispatcher';

/**
 * **بوابة SMS محايدة المزوّد** — نقطة الحقن الوحيدة لأي إرسال SMS في المشروع.
 *
 * قبلها كان `AuthService` و`CompositeNotificationDispatcher` بيحقنوا `TwilioSmsDispatcher`
 * **بالاسم**، يعني تغيير المزوّد = تعديل في كل مستهلك + كل اختبار بيبنيهم. دلوقتي المستهلك
 * بيطلب `SMS_DISPATCHER` والتركيب هو اللي بيقرّر مين ينفّذ (`SMS_PROVIDER`).
 *
 * **دورة حياة الـOTP بتفضل ملك Osta بالكامل** (توليد، bcrypt، صلاحية، عدد المحاولات، إبطال عند
 * إعادة الإرسال، التحقق من قاعدة بياناتنا). المزوّد ده **قناة تسليم نص** وبس — مش مصدر ثقة،
 * ومابنستخدمش أي «verify API» خارجي. أي انتقال لده قرار منفصل صريح، مش أثر جانبي لتبديل مزوّد.
 */
export interface SmsDispatcher {
  /** `false` = المزوّد مش مُعدّ؛ المستهلك بيرجع للـlog-only بدل ما ينهار. */
  readonly isConfigured: boolean;
  /** اسم المزوّد للتشخيص واللوج — **مش** بيتسجّل معاه أي سر. */
  readonly providerName: string;
  send(input: DispatchNotificationInput): Promise<DispatchResult>;
}

export const SMS_DISPATCHER = Symbol('SMS_DISPATCHER');

/** المزوّدات المدعومة. `SMS_PROVIDER` بياخد واحدة منهم بس. */
export const SMS_PROVIDERS = ['twilio', 'cequens'] as const;
export type SmsProvider = (typeof SMS_PROVIDERS)[number];
