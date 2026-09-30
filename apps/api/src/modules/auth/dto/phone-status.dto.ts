import { Transform } from 'class-transformer';
import { IsPhoneNumber } from 'class-validator';
import { normalizePhoneNumber } from '../../../common/utils/phone-number';

/** «الرقم ده مسجّل؟» (ADR-0115) — نفس تطبيع الرقم بالظبط زي الدخول والتسجيل. */
export class PhoneStatusDto {
  @Transform(({ value }) => normalizePhoneNumber(value))
  @IsPhoneNumber(undefined)
  phone_number: string;
}
