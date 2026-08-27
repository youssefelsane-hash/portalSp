import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * الرقم القومي (ADR-0045). التحقق من الشكل الحقيقي (14 رقم بعد التطبيع) بيحصل في
 * `TechnicianIdentityService` مش هنا — عشان التطبيع (أرقام عربية → لاتينية، شيل المسافات) لازم
 * يسبق التحقق، والـDTO بتشوف النص الخام زي ما اتكتب.
 */
export class SetNationalIdDto {
  @IsString()
  @MinLength(14)
  @MaxLength(32) // مساحة للمسافات/الشرطات اللي التطبيع بيشيلها
  national_id: string;
}
