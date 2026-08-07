import { IsPhoneNumber, IsString, Length } from 'class-validator';

// بتستخدم لتسجيل الدخول (purpose=login) — التسجيل نفسه بيتم عبر /auth/register
export class VerifyOtpDto {
  @IsPhoneNumber(undefined)
  phone_number: string;

  @IsString()
  @Length(6, 6)
  otp_code: string;
}
