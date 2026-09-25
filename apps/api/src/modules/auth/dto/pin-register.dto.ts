import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsPhoneNumber, IsString, Length } from 'class-validator';
import { normalizePhoneNumber } from '../../../common/utils/phone-number';
import { UserType } from '../entities/user.entity';
import { DeviceMetadataDto } from './device-metadata.dto';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../login-pin.policy';

/**
 * تسجيل حساب جديد برمز دخول (ADR-0109).
 *
 * **نسخة طبق الأصل من `RegisterDto`** ما عدا `otp_code` ← `pin`. كل حقول الإسناد الاختيارية
 * (ترشيح، ترشيح فني، إعلانات، رابط عرض) موجودة بنفس القيود بالحرف — لأن `register()` بتصدّر
 * نفس الخمس أحداث، وأي حقل ناقص هنا معناه قناة إسناد بتموت بصمت.
 */
export class PinRegisterDto extends DeviceMetadataDto {
  @Transform(({ value }) => normalizePhoneNumber(value))
  @IsPhoneNumber(undefined)
  phone_number: string;

  @IsString()
  @Length(PIN_MIN_LENGTH, PIN_MAX_LENGTH)
  pin: string;

  @IsString()
  @Length(2, 120)
  full_name: string;

  @IsIn([UserType.CUSTOMER, UserType.TECHNICIAN])
  user_type: UserType.CUSTOMER | UserType.TECHNICIAN;

  @IsOptional()
  @IsString()
  @Length(3, 12)
  referral_code?: string;

  @IsOptional()
  @IsString()
  @Length(3, 20)
  technician_referral_code?: string;

  @IsOptional()
  @IsString()
  @Length(3, 24)
  marketing_code?: string;

  @IsOptional()
  @IsString()
  @Length(3, 24)
  promo_link_code?: string;
}
