import { IsObject, IsOptional, IsString } from 'class-validator';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { DeviceMetadataDto } from './device-metadata.dto';

export class WebAuthnAuthenticationVerifyDto extends DeviceMetadataDto {
  @IsObject()
  response: AuthenticationResponseJSON;

  // مطلوب لمسار MFA login (السيرفر عارف الهوية بالفعل من OTP قبل كده) — اختياري لمسار الدخول
  // السريع بـPasskey بس (discoverable credential، السيرفر بيعرف الهوية من userHandle الرد نفسه).
  @IsOptional()
  @IsString()
  mfa_session_token?: string;
}
