import { IsOptional, IsString, Length } from 'class-validator';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../login-pin.policy';

/**
 * تعيين/تغيير رمز الدخول لمستخدم **متوثّق بالفعل** (ADR-0109 §6-أ).
 *
 * ده مسار هجرة المستخدمين الحاليين: اللي لسه داخل (والتوكن محفوظ عنده) بيحط رمزه من جوّه
 * التطبيق. آمن لأن الجلسة قايمة أصلاً — مفيش استيلاء ممكن.
 *
 * `current_pin` مطلوب **بس** لو الحساب ليه رمز بالفعل (تغيير مش تعيين أول مرة). الخدمة هي
 * اللي بتفرضه — الـDTO مابيعرفش حالة الحساب.
 */
export class SetPinDto {
  @IsString()
  @Length(PIN_MIN_LENGTH, PIN_MAX_LENGTH)
  pin: string;

  @IsOptional()
  @IsString()
  @Length(PIN_MIN_LENGTH, PIN_MAX_LENGTH)
  current_pin?: string;
}
