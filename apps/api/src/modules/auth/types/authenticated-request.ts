import { Request } from 'express';
import { UserType } from '../entities/user.entity';

export interface JwtPayload {
  sub: string; // user id
  /**
   * **الدور النشط في الجلسة دي** (ADR-0110) — مش «نوع المستخدم الأبدي».
   *
   * لحساب موظف = `user_type` بتاعه زي ما كان بالظبط. لحساب استهلاكي = الدور اللي التطبيق طلبه
   * **وتحقّق منه السيرفر** من `user_role_grants`. `RolesGuard` بيقارن القيمة دي بقايمة المسار
   * بلا أي تعديل — فمستخدم عنده الدورين بياخد صلاحيات التطبيق اللي هو فاتح منه بس.
   */
  userType: UserType;
  /**
   * كل الأدوار الاستهلاكية الممنوحة للحساب. **للواجهة بس** — الحُرّاس بتقرا `userType`.
   * غايبة في توكنز اتصدرت قبل ADR-0110 وفي توكنز الموظفين.
   */
  roles?: ('customer' | 'technician')[];
  // Authentication Methods Reference (ADR-0011) — إزاي المستخدم أثبت هويته فعليًا لإصدار
  // التوكن ده. ['otp'] للحسابات العادية (زي ما هو دايمًا)، ['otp','webauthn'] بعد MFA كامل،
  // ['webauthn'] للدخول السريع اليومي بـPasskey بس (discoverable credential).
  amr: ('otp' | 'pin' | 'webauthn')[];
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
