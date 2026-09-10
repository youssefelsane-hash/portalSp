import { Module } from '@nestjs/common';
import { SMS_DISPATCHER } from './sms-dispatcher';
import { SMS_DISPATCHER_PROVIDERS } from './sms-dispatcher.provider';

/**
 * موديول بوابة الـSMS — **نسخة واحدة** مشتركة بين كل مستهلك (`AuthModule` لكود التحقق،
 * `NotificationsModule` لباقي الإشعارات).
 *
 * السبب إنه موديول مستقل مش مجرد `...SMS_DISPATCHER_PROVIDERS` في كل موديول: تكرار الـproviders
 * بيعمل **نسخة لكل موديول**، يعني كل نسخة بكاش توكن OAuth خاص بيها = نداءات توكن زيادة لـCEQUENS
 * وسطر اختيار مكرر في اللوج وقت الإقلاع. موديول واحد = نسخة واحدة = كاش واحد.
 */
@Module({
  providers: SMS_DISPATCHER_PROVIDERS,
  exports: [SMS_DISPATCHER],
})
export class SmsModule {}
