import { IsEnum, IsPhoneNumber } from 'class-validator';
import { OtpPurpose } from '../entities/otp-code.entity';

export class RequestOtpDto {
  @IsPhoneNumber(undefined, { message: 'رقم الموبايل لازم يكون بصيغة دولية صحيحة (+201001234567)' })
  phone_number: string;

  @IsEnum(OtpPurpose)
  purpose: OtpPurpose;
}
