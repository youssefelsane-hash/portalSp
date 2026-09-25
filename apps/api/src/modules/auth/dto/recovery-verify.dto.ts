import { IsPhoneNumber, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizePhoneNumber } from '../../../common/utils/phone-number';

// استرجاع MFA (ADR-0011 §6) — لازم **رمز الدخول + كود استرجاع** مع بعض، عاملين مستقلين.
//
// **ADR-0109**: العامل الأول كان `otp_code` (إثبات ملكية الرقم) وبقى `pin` (سر يعرفه صاحب
// الحساب). العدد ماتغيّرش — لسه عاملين، وكود الاسترجاع لوحده مايكفيش. الطول ٤–٦ زي أي رمز
// دخول، مش ٦ ثابت زي كود الـSMS.
export class RecoveryVerifyDto {
  @Transform(({ value }) => normalizePhoneNumber(value))
  @IsPhoneNumber(undefined)
  phone_number: string;

  @IsString()
  @Length(4, 6)
  pin: string;

  @IsString()
  @Length(14, 14) // "XXXX-XXXX-XXXX"
  recovery_code: string;
}
