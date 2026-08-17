import { IsPhoneNumber, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizePhoneNumber } from '../../../common/utils/phone-number';
import { DeviceMetadataDto } from './device-metadata.dto';

// بتستخدم لتسجيل الدخول (purpose=login) — التسجيل نفسه بيتم عبر /auth/register
export class VerifyOtpDto extends DeviceMetadataDto {
  @Transform(({ value }) => normalizePhoneNumber(value))
  @IsPhoneNumber(undefined)
  phone_number: string;

  @IsString()
  @Length(6, 6)
  otp_code: string;
}
