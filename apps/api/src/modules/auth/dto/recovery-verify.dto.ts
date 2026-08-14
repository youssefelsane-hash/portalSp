import { IsPhoneNumber, IsString, Length } from 'class-validator';

// استرجاع MFA (ADR-0011 §6) — لازم OTP + recovery code مع بعض، عاملين مستقلين. مش SMS بمفرده.
export class RecoveryVerifyDto {
  @IsPhoneNumber(undefined)
  phone_number: string;

  @IsString()
  @Length(6, 6)
  otp_code: string;

  @IsString()
  @Length(14, 14) // "XXXX-XXXX-XXXX"
  recovery_code: string;
}
