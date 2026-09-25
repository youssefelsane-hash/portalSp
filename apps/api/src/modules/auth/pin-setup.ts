import { randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { EntityManager, IsNull } from 'typeorm';
import { PIN_BCRYPT_ROUNDS, PIN_RESET_CODE_LENGTH, PIN_RESET_CODE_TTL_MINUTES } from './login-pin.policy';
import { PinResetToken } from './entities/pin-reset-token.entity';
import { User } from './entities/user.entity';

/**
 * **إصدار تصريح «حُط رمزك»** — مصدر واحد لكل حالة حساب محتاج يعيّن رمز وهو **مش قادر يدخل**
 * (ADR-0109 §6-ب، ADR-0111).
 *
 * حالتين بيستخدموه:
 *   ١) **استرجاع**: مستخدم نسي رمزه ← `AuthService.adminResetPin` (بتمسح الرمز القديم كمان).
 *   ٢) **تنشيط موظف جديد**: الأدمن عمل الحساب ومفيش رمز من الأصل ← `AdminEmployeesService`.
 *
 * **ليه دالة واحدة**: الحالتين نفس التصريح بالظبط — كود ١٠ أرقام، ١٥ دقيقة، لمرة واحدة، مخزّن
 * bcrypt، وبيتستهلك من نفس `POST /auth/pin/reset/redeem`. نسخة تانية من الميكانيزم معناها
 * سياستين أمان على نفس الحاجة، وواحدة هتتخلف عن التانية أول تعديل.
 *
 * **ليه دالة حرة مش خدمة بـDI**: `AuthModule` بيستورد `AdminModule` أصلاً (PermissionsService
 * لـMfaPolicyService)، فحقن `AuthService` في موديول الإدارة كان بيعمل دايرة محتاجة `forwardRef`.
 * الملف ده مالوش أي حالة ولا تبعيات — بياخد `EntityManager` وبيكتب بيه، فالمُنادي بيتحكم في
 * المعاملة وكل الأطراف بتشارك **نفس** الكود بلا أي دايرة. (الكودبيس بيتجنّب `forwardRef` عمدًا —
 * `pricing.module.ts` و`technician-earnings.module.ts` موثّقين بنفس المنطق.)
 *
 * @param clearExistingPin مسح الرمز الحالي. `true` للاسترجاع (الرمز القديم لازم يموت)، و`false`
 *   للتنشيط — الحساب الجديد مالوش رمز أصلاً فمفيش حاجة تتمسح.
 */
export async function issuePinSetupCode(
  manager: EntityManager,
  {
    userId,
    issuedByUserId,
    clearExistingPin,
  }: { userId: string; issuedByUserId: string; clearExistingPin: boolean },
): Promise<{ code: string; expiresAt: Date }> {
  const code = Array.from({ length: PIN_RESET_CODE_LENGTH }, () => randomInt(0, 10)).join('');
  const expiresAt = new Date(Date.now() + PIN_RESET_CODE_TTL_MINUTES * 60_000);

  if (clearExistingPin) {
    await manager.update(
      User,
      { id: userId },
      { pinHash: null, pinSetAt: null, pinFailedAttempts: 0, pinLockedUntil: null },
    );
  }
  // إصدار كود جديد **بيبطّل** كل الأكواد الحية القديمة — مايبقاش فيه تصريحين حيين على نفس
  // الحساب، وإلا كود قديم من مكالمة سابقة يفضل صالح بلا علم حد.
  await manager.softDelete(PinResetToken, { userId, usedAt: IsNull() });
  await manager.save(
    manager.create(PinResetToken, {
      userId,
      codeHash: await bcrypt.hash(code, PIN_BCRYPT_ROUNDS),
      expiresAt,
      issuedByUserId,
    }),
  );
  return { code, expiresAt };
}
