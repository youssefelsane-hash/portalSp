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

// ADR-0011 — لو الحساب High-Privilege ومحتاج MFA، /auth/otp/verify (وrecovery/verify) بيرجّع
// الشكل ده بدل TokenPair مباشرة. ceremony='registration' يعني مفيش Passkey مسجّل لسه، 'authentication'
// يعني فيه Passkey موجود بالفعل والمطلوب بس تأكيده.
export type MfaCeremony = 'registration' | 'authentication';

export interface MfaRequiredResponse {
  mfa_required: true;
  ceremony: MfaCeremony;
  mfa_session_token: string;
}

export type LoginResult = TokenPair | MfaRequiredResponse;

export function isMfaRequiredResponse(result: LoginResult): result is MfaRequiredResponse {
  return (result as MfaRequiredResponse).mfa_required === true;
}

export interface RecoveryVerifyBody {
  phone_number: string;
  otp_code: string;
  recovery_code: string;
}

export interface WebAuthnCredentialResponseDto {
  id: string;
  device_label: string | null;
  backed_up: boolean;
  last_used_at: string | null;
  created_at: string;
}

export interface AuthSessionResponseDto {
  id: string;
  device_name: string | null;
  device_platform: string | null;
  ip_address: string | null;
  amr: string[];
  last_seen_at: string | null;
  created_at: string;
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
