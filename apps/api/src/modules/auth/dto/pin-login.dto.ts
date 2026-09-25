import { Transform } from 'class-transformer';
import { IsPhoneNumber, IsString, Length } from 'class-validator';
import { normalizePhoneNumber } from '../../../common/utils/phone-number';
import { DeviceMetadataDto } from './device-metadata.dto';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../login-pin.policy';

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
  @Length(PIN_MIN_LENGTH, PIN_MAX_LENGTH)
  pin: string;
}
