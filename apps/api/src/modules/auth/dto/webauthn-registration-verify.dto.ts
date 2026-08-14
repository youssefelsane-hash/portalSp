import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

// شكل response نفسه معقّد ومتداخل (من navigator.credentials.create() عبر @simplewebauthn/browser)
// — verifyRegistrationResponse() في @simplewebauthn/server هي المُتحقّق الفعلي والموثوق من شكله
// وتوقيعه، مش داعي نكرر تحقق class-validator تفصيلي هنا (نفس فلسفة أي webhook payload خارجي
// تاني في المشروع، زي Paymob).
export class WebAuthnRegistrationVerifyDto {
  @IsObject()
  response: RegistrationResponseJSON;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  device_label?: string;

  // مطلوب دايمًا فعليًا (تسجيل Passkey جديد بيحصل جوّه مسار MFA بس) — IsOptional هنا بس عشان
  // WebAuthnController.requireMfaSessionUserId() هو اللي بيرمي الخطأ الواضح لو غايب، مش
  // class-validator generic error.
  @IsOptional()
  @IsString()
  mfa_session_token?: string;
}
