import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CequensSmsDispatcher } from './cequens-sms-dispatcher.service';
import { SMS_DISPATCHER, SmsDispatcher, SmsProvider } from './sms-dispatcher';
import { TwilioSmsDispatcher } from './twilio-sms-dispatcher.service';

/**
 * اختيار مزوّد الـSMS وقت التركيب — نقطة القرار **الوحيدة** في المشروع.
 *
 * `SMS_PROVIDER=cequens` (الافتراضي لإطلاق مصر) بيختار CEQUENS، و`twilio` بيختار Twilio.
 * لو المزوّد المختار مش مُعدّ بينما التاني مُعدّ، بنرجع للتاني **بتحذير صريح في اللوج** بدل ما
 * كود التحقق مايوصلش لحد: بوابة الـSMS هي القناة الوحيدة لتسليم الـOTP، فسقوطها بصمت =
 * صفر تسجيل دخول لأي مستخدم حقيقي. لو الاتنين مش مُعدّين، `isConfigured=false` بيوصل
 * للمستهلك اللي بيرجع لـlog-only (نفس فلسفة باقي القنوات).
 */
export function selectSmsDispatcher(
  config: ConfigService,
  twilio: TwilioSmsDispatcher,
  cequens: CequensSmsDispatcher,
): SmsDispatcher {
  const logger = new Logger('SmsDispatcherSelection');
  const provider = (config.get<string>('notifications.smsProvider') ?? 'cequens') as SmsProvider;
  const primary: SmsDispatcher = provider === 'twilio' ? twilio : cequens;
  const secondary: SmsDispatcher = provider === 'twilio' ? cequens : twilio;

  if (primary.isConfigured) {
    logger.log(`مزوّد SMS الفعّال: ${primary.providerName}`);
    return primary;
  }
  if (secondary.isConfigured) {
    logger.warn(
      `SMS_PROVIDER=${provider} لكن ${primary.providerName} مش مُعدّ — الرجوع لـ${secondary.providerName} عشان كود التحقق يفضل بيوصل`,
    );
    return secondary;
  }
  logger.warn(`مفيش أي بوابة SMS مُعدّة (SMS_PROVIDER=${provider}) — الرسائل هتتسجّل في اللوج بس`);
  return primary;
}

/**
 * بيتضاف كـ`...SMS_DISPATCHER_PROVIDERS` في أي موديول محتاج يبعت SMS. بيسجّل التنفيذين
 * الملموسين + الـtoken المحايد؛ المستهلك بيحقن الـtoken بس.
 */
export const SMS_DISPATCHER_PROVIDERS: Provider[] = [
  TwilioSmsDispatcher,
  CequensSmsDispatcher,
  {
    provide: SMS_DISPATCHER,
    useFactory: selectSmsDispatcher,
    inject: [ConfigService, TwilioSmsDispatcher, CequensSmsDispatcher],
  },
];
