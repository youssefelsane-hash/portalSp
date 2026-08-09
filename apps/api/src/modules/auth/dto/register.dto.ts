import { IsIn, IsOptional, IsPhoneNumber, IsString, Length } from 'class-validator';
import { UserType } from '../entities/user.entity';

export class RegisterDto {
  @IsPhoneNumber(undefined)
  phone_number: string;

  @IsString()
  @Length(6, 6)
  otp_code: string;

  @IsString()
  @Length(2, 120)
  full_name: string;

  // التسجيل الذاتي مسموح بس للعميل أو الفني — الأدمن يتضاف يدوياً من لوحة التحكم
  @IsIn([UserType.CUSTOMER, UserType.TECHNICIAN])
  user_type: UserType.CUSTOMER | UserType.TECHNICIAN;

  // اختياري — كود ترشيح مستخدم موجود (users.referral_code). لو اتبعت وكان غلط، التسجيل بيترفض
  // برسالة واضحة بدل ما نتجاهله بصمت (نظام الترشيحات، راجع referrals module).
  @IsOptional()
  @IsString()
  @Length(3, 12)
  referral_code?: string;
}
