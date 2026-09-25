import { User } from '../entities/user.entity';
import { AccountRole } from '../entities/user-role-grant.entity';

// كل استجابات الـ API لازم تكون snake_case (زي كل الـ DTOs في الموديول ده) —
// TypeORM entity بره الموديول ده لازم يتحول هنا، مايتسربش زي ما هو (camelCase) للعميل أبداً.
export interface UserResponseDto {
  id: string;
  phone_number: string;
  phone_verified: boolean;

  /**
   * هل الحساب ليه رمز دخول؟ (ADR-0109)
   *
   * الواجهة بتستخدمها عشان تعرف تطلب من المستخدم القديم يحط رمزه — من غيرها كانت هتحتاج نداء
   * زيادة على كل فتح للتطبيق. **مش سر**: بتقول «فيه رمز» مش الرمز نفسه، وبتترد للمستخدم
   * صاحب الحساب بس (مسار `/auth/me` متوثّق).
   */
  pin_set: boolean;
  email: string | null;
  full_name: string;
  avatar_url: string | null;
  /**
   * **الدور النشط في الجلسة** (ADR-0110) — مش عمود `users.user_type` الخام.
   *
   * لمستخدم عنده دور واحد (الغالبية العظمى) القيمتين متطابقتين، فمفيش أي تغيير في السلوك. لمستخدم
   * عنده الدورين، التطبيق لازم يشوف الدور اللي هو فاتح بيه — لو شاف الدور التاني كان هيرسم شاشات
   * الدور الغلط ويقع على أول نداء محمي، وهي **بالظبط** البَقّة اللي ADR-0110 اتكتب لها.
   */
  user_type: string;
  /** كل الأدوار الممنوحة للحساب — التطبيق بيستخدمها يعرض «بدّل لتطبيق الصنايعي» أو يخفيها. */
  roles?: AccountRole[];
  preferred_language: string;
  created_at: string;
}

/**
 * @param session سياق الجلسة (ADR-0110). لو مش موجود، `user_type` بيرجع عمود القاعدة الخام —
 *   وده الصح لكل المستهلكين اللي مالهمش جلسة (لوحة الأدمن بتقرا مستخدمين تانيين).
 */
export function toUserResponseDto(
  user: User,
  session?: { activeRole?: string; roles?: AccountRole[] },
): UserResponseDto {
  return {
    id: user.id,
    phone_number: user.phoneNumber,
    phone_verified: user.phoneVerifiedAt !== null,
    pin_set: user.pinSetAt !== null,
    email: user.email,
    full_name: user.fullName,
    avatar_url: user.avatarUrl,
    user_type: session?.activeRole ?? user.userType,
    ...(session?.roles ? { roles: session.roles } : {}),
    preferred_language: user.preferredLanguage,
    created_at: user.createdAt.toISOString(),
  };
}
