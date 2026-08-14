import { Request } from 'express';
import { UserType } from '../entities/user.entity';

export interface JwtPayload {
  sub: string; // user id
  userType: UserType;
  // Authentication Methods Reference (ADR-0011) — إزاي المستخدم أثبت هويته فعليًا لإصدار
  // التوكن ده. ['otp'] للحسابات العادية (زي ما هو دايمًا)، ['otp','webauthn'] بعد MFA كامل،
  // ['webauthn'] للدخول السريع اليومي بـPasskey بس (discoverable credential).
  amr: ('otp' | 'webauthn')[];
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
