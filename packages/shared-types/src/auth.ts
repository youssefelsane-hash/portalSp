// مطابق لـ apps/api/src/modules/auth (docs/02-data-dictionary.md §13.1)
export type OtpPurpose = 'register' | 'login' | 'reset_password' | 'verify_phone';

export interface RequestOtpBody {
  phone_number: string;
  purpose: OtpPurpose;
}

export interface VerifyOtpBody {
  phone_number: string;
  otp_code: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in_seconds: number;
}

export interface UserResponseDto {
  id: string;
  phone_number: string;
  phone_verified: boolean;
  email: string | null;
  full_name: string;
  avatar_url: string | null;
  user_type: string;
  preferred_language: string;
  created_at: string;
}
