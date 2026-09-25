import { Transform } from 'class-transformer';
import { IsOptional, IsPhoneNumber, IsString, Length } from 'class-validator';
import { normalizePhoneNumber } from '../../../common/utils/phone-number';
import { LEGACY_PIN_MIN_LENGTH, PIN_MAX_LENGTH } from '../login-pin.policy';
import { OTP_CODE_LENGTH } from '../auth.service';

/**
 * **طلب كود تأكيد الرقم** (ADR-0112).
 *
 * `new_phone_number` اختياري: غيابه = تأكيد الرقم الحالي، ووجوده = **تصحيح الرقم**، وساعتها
 * `pin` إجباري (عاملين مستقلين — الشرح في `PhoneVerificationService.requestCode`). الإجبار
 * نفسه في الخدمة مش هنا عشان الرسالة تبقى عربي مفهوم بدل خطأ تحقّق عام.
 */
export class RequestPhoneVerificationDto {
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null ? value : normalizePhoneNumber(value)))
  @IsPhoneNumber(undefined, { message: 'رقم الموبايل لازم يكون بصيغة دولية صحيحة (+201001234567)' })
  new_phone_number?: string;

  // الطول بيقبل ٤–٦ زي شاشة الدخول بالظبط: مستخدم عمل رمزه قبل التصليب لازم يقدر يستخدمه هنا،
  // وإلا كان بيتقفل برّه تصحيح رقمه بسبب طول رمز قديم مسموح في الدخول.
  @IsOptional()
  @IsString()
  @Length(LEGACY_PIN_MIN_LENGTH, PIN_MAX_LENGTH)
  pin?: string;
}

/** **تأكيد الكود.** `new_phone_number` لازم يطابق اللي اتبعت له الكود، وإلا الاستهلاك بيفشل. */
export class ConfirmPhoneVerificationDto {
  @IsString()
  @Length(OTP_CODE_LENGTH, OTP_CODE_LENGTH)
  otp_code: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null ? value : normalizePhoneNumber(value)))
  @IsPhoneNumber(undefined, { message: 'رقم الموبايل لازم يكون بصيغة دولية صحيحة (+201001234567)' })
  new_phone_number?: string;
}
