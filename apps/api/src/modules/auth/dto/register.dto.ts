import { IsIn, IsOptional, IsPhoneNumber, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizePhoneNumber } from '../../../common/utils/phone-number';
import { UserType } from '../entities/user.entity';

export class RegisterDto {
  @Transform(({ value }) => normalizePhoneNumber(value))
  @IsPhoneNumber(undefined)
  phone_number: string;

  @IsString()
  @Length(6, 6)
  otp_code: string;

  @IsString()
  @Length(2, 120)
  full_name: string;

  // التسجيل الذاتي مسموح للعميل أو الفني بس (مزوّد خدمة واحد موحّد، ADR-0031 — الشغالة/المربية
  // بقت تسجّل بنفس مسار الفني بالظبط، صفر نوع حساب مستقل). الأدمن يتضاف يدوياً من لوحة التحكم بس.
  @IsIn([UserType.CUSTOMER, UserType.TECHNICIAN])
  user_type: UserType.CUSTOMER | UserType.TECHNICIAN;

  // اختياري — كود ترشيح مستخدم موجود (users.referral_code). لو اتبعت وكان غلط، التسجيل بيترفض
  // برسالة واضحة بدل ما نتجاهله بصمت (نظام الترشيحات، راجع referrals module).
  @IsOptional()
  @IsString()
  @Length(3, 12)
  referral_code?: string;

  // اختياري — كود ترشيح فني (technician_profiles.technician_code، مسح QR أو deep link، docs/11
  // §1). مختلف تمامًا عن referral_code فوق (ترشيح عميل-لعميل). خطأ في الكود ده **مايوقفش
  // التسجيل** (خلاف referral_code) — نظام مكافأة الفني ثانوي، مش شرط لإنشاء الحساب.
  @IsOptional()
  @IsString()
  @Length(3, 20)
  technician_referral_code?: string;
}
