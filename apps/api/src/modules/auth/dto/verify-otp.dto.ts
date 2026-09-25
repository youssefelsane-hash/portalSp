import { IsEnum, IsOptional, IsPhoneNumber, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizePhoneNumber } from '../../../common/utils/phone-number';
import { AccountRole } from '../entities/user-role-grant.entity';
import { DeviceMetadataDto } from './device-metadata.dto';

// بتستخدم لتسجيل الدخول (purpose=login) — التسجيل نفسه بيتم عبر /auth/register
export class VerifyOtpDto extends DeviceMetadataDto {
  @Transform(({ value }) => normalizePhoneNumber(value))
  @IsPhoneNumber(undefined)
  phone_number: string;

  @IsString()
  @Length(6, 6)
  otp_code: string;

  /**
   * الدور اللي التطبيق ده بيدخل بيه (ADR-0110) — **نسخة طبق الأصل من `PinLoginDto.role`**.
   * موجود هنا عشان مسار الـOTP ومسار الرمز مايفترقوش في قرار أمني: أي فحص يتضاف لواحد ويتنسى
   * في التاني يبقى باب خلفي كامل لنفس الحساب.
   */
  @IsOptional()
  @IsEnum(AccountRole)
  role?: AccountRole;
}
