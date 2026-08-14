import { IsPhoneNumber, IsString, Length } from 'class-validator';
import { DeviceMetadataDto } from './device-metadata.dto';

// بتستخدم لتسجيل الدخول (purpose=login) — التسجيل نفسه بيتم عبر /auth/register
export class VerifyOtpDto extends DeviceMetadataDto {
  @IsPhoneNumber(undefined)
  phone_number: string;

  @IsString()
  @Length(6, 6)
  otp_code: string;
}
