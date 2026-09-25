import { IsNumberString, IsPhoneNumber, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizePhoneNumber } from '../../../common/utils/phone-number';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH, PIN_RESET_CODE_LENGTH } from '../login-pin.policy';

/**
 * **استهلاك كود استرجاع رمز الدخول** (ADR-0109 §6-ب).
 *
 * الكود بيجي من الدعم في مكالمة بعد ما يتأكد من هوية العميل. العميل بيكتبه هنا **مع الرمز
 * الجديد اللي اختاره هو** — الأدمن عمره ما يعرف الرمز.
 */
export class PinResetRedeemDto {
  @Transform(({ value }) => normalizePhoneNumber(value))
  @IsPhoneNumber(undefined)
  phone_number: string;

  @IsNumberString({ no_symbols: true })
  @Length(PIN_RESET_CODE_LENGTH, PIN_RESET_CODE_LENGTH)
  reset_code: string;

  // الفحص الحقيقي (أرقام بس، مش ضعيف) في `validatePinFormat` — الطول هنا بس عشان طلب مشوّه
  // ما يوصلش لـbcrypt أصلاً.
  @IsString()
  @Length(PIN_MIN_LENGTH, PIN_MAX_LENGTH)
  pin: string;
}
