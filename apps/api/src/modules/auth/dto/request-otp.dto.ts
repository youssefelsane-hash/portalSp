import { IsEnum, IsPhoneNumber } from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizePhoneNumber } from '../../../common/utils/phone-number';
import { OtpPurpose } from '../entities/otp-code.entity';

export class RequestOtpDto {
  @Transform(({ value }) => normalizePhoneNumber(value))
  @IsPhoneNumber(undefined, { message: 'رقم الموبايل لازم يكون بصيغة دولية صحيحة (+201001234567)' })
  phone_number: string;

  @IsEnum(OtpPurpose)
  purpose: OtpPurpose;
}
