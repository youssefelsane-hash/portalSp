import { User } from '../entities/user.entity';

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
  user_type: string;
  preferred_language: string;
  created_at: string;
}

export function toUserResponseDto(user: User): UserResponseDto {
  return {
    id: user.id,
    phone_number: user.phoneNumber,
    phone_verified: user.phoneVerifiedAt !== null,
    pin_set: user.pinSetAt !== null,
    email: user.email,
    full_name: user.fullName,
    avatar_url: user.avatarUrl,
    user_type: user.userType,
    preferred_language: user.preferredLanguage,
    created_at: user.createdAt.toISOString(),
  };
}
