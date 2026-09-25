import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsPhoneNumber, IsString, Length } from 'class-validator';
import { normalizePhoneNumber } from '../../../common/utils/phone-number';
import { AccountRole } from '../entities/user-role-grant.entity';
import { DeviceMetadataDto } from './device-metadata.dto';
import { LEGACY_PIN_MIN_LENGTH, PIN_MAX_LENGTH } from '../login-pin.policy';

/**
 * دخول برقم + رمز (ADR-0109). نفس تطبيع الرقم بالظبط اللي `VerifyOtpDto` بيستخدمه — الرقم هو
 * هوية الحساب ومينفعش يتطبّع بطريقتين مختلفتين في مسارين للدخول.
 */
export class PinLoginDto extends DeviceMetadataDto {
  @Transform(({ value }) => normalizePhoneNumber(value))
  @IsPhoneNumber(undefined)
  phone_number: string;

  // الطول بيتفحص هنا للرد السريع، والسياسة الكاملة (أرقام بس + رفض الضعيف) في
  // `validatePinFormat` — مصدر واحد للقاعدة، والـDTO حارس شكل بس.
  @IsString()
  @Length(LEGACY_PIN_MIN_LENGTH, PIN_MAX_LENGTH)
  pin: string;

  /**
   * الدور اللي التطبيق ده بيدخل بيه (ADR-0110). `customer` من تطبيق العميل، `technician` من
   * تطبيق الفني.
   *
   * **طلب، مش حقيقة**: السيرفر بيتحقق من المنحة قبل ما يوقّع التوكن (`resolveActiveRole`).
   * اختياري عمدًا — النسخ المنشورة على Google Play مابتبعتوش، فبتاخد دور `user_type` زي
   * ما كانت بالظبط.
   */
  @IsOptional()
  @IsEnum(AccountRole)
  role?: AccountRole;
}
