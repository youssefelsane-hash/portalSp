import { IsDefined } from 'class-validator';

export class UpdateSettingDto {
  // القيمة ممكن تكون رقم/بوليان/نص/أي JSON حسب value_type بتاع الإعداد — التحقق الفعلي
  // بيحصل في SettingsService.assertValueMatchesType()، مش هنا، عشان مفيش enum ثابت للأنواع.
  // @IsDefined() لازم تتحط عشان الـ whitelist:true العام مايشيلش الحقل ده صامت (نفس بَقّة اتصلحت قبل كده).
  @IsDefined()
  value: unknown;
}
