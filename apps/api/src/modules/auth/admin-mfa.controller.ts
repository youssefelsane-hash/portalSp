import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditLogService } from '../audit/audit-log.service';
import { AuthService } from './auth.service';
import { UserType } from './entities/user.entity';
import { JwtPayload } from './types/authenticated-request';
import { WebAuthnService } from './webauthn.service';

// إعادة تعيين MFA إداري — المسار الوحيد لو أدمن فقد كل أكواد الاسترجاع العشرة من غير ما
// يستخدمهم (ADR-0011 §6). محتاج super_admin تاني عنده Passkey شغال فعليًا (roles.manage +
// step-up)، مش أي حد. بيمسح الـPasskeys/أكواد الاسترجاع بتاعة المستخدم المتأثر بالكامل ويلغي
// كل جلساته — يرجع يعمل enrollment كامل تاني من الصفر أول ما يسجّل دخول بـOTP تاني.
@Controller('admin/users')
@Roles(UserType.ADMIN)
export class AdminMfaController {
  constructor(
    private readonly webAuthnService: WebAuthnService,
    private readonly authService: AuthService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Post(':id/mfa/reset')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('roles.manage')
  @RequireStepUp()
  async resetMfa(
    @CurrentUser() actor: JwtPayload,
    @Param('id', ParseUUIDPipe) targetUserId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.webAuthnService.resetMfa(targetUserId);
    await this.authService.revokeAllUserTokens(targetUserId, 'admin_mfa_reset');
    await this.auditLog.record({
      actorUserId: actor.sub,
      actorRole: actor.userType,
      action: 'admin_mfa.reset',
      entityType: 'user',
      entityId: targetUserId,
      meta: audit,
    });
    return null;
  }

  /**
   * **استرجاع رمز الدخول** (ADR-0109 §6-ب) — الدعم بيعمله بعد ما يتأكد من هوية العميل
   * في مكالمة. ده المسار الوحيد لعميل نسي رمزه، لأن مفيش SMS بعد التبديل.
   *
   * القرارات المقصودة:
   * - **بيمسح الرمز، ومابيحطّش واحد جديد.** لو الأدمن اختار الرمز، يبقى فيه بني آدم تاني يعرف
   *   سر دخول العميل ولازم يتقال في مكالمة — تسريب بالتصميم، والأسوأ إن أغلب الناس مابتغيّرش
   *   الرمز المؤقت بعد كده.
   * - **بيرجّع كود استرجاع لمرة واحدة** (`reset_code`، ١٠ أرقام، ١٥ دقيقة) الأدمن بيقوله للعميل
   *   في نفس المكالمة، والعميل بيستهلكه على `POST /auth/pin/reset/redeem` **ويختار رمزه بنفسه**.
   *   ده اللي بيقفل فجوة حقيقية كانت موجودة: مسح الرمز لوحده كان بيسيب المستخدم في **طريق
   *   مسدود تام** — مايقدرش يدخل (مفيش رمز)، ومايقدرش يستخدم `POST /auth/pin` (محتاج جلسة، وكل
   *   جلساته اتلغت في نفس الإجراء)، ومفيش SMS. الاسترجاع كان بيقفل الحساب بدل ما يفتحه.
   * - **الكود مش رمز دخول**: مايفتحش جلسة ومايرجّعش توكن — تصريح لتعيين رمز وبس، فلو اتسرّب بعد
   *   الاستهلاك مالوش أي قيمة.
   * - **بيلغي كل الجلسات القايمة** (جوّه `adminResetPin`). لو الحساب كان متسرّب فعلاً،
   *   الاسترجاع بيقفل اللي واخده برّه بدل ما يسيبه جوّه.
   * - **صلاحية مستقلة** `users.reset_pin` مش `customers.manage`: ده إجراء **بيفك قفل حساب**،
   *   مش تعديل بيانات. موظف بيعدّل عناوين مالوش لازمة يقدر يفتح حسابات.
   * - **step-up + سجل تدقيق**: مفيش إثبات تقني لهوية العميل في مكالمة تليفون، فالسجل هو الأثر
   *   الوحيد اللي بيخلي الإجراء قابل للمراجعة — مين عمله، لمين، وإمتى.
   */
  @Post(':id/pin/reset')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('users.reset_pin')
  @RequireStepUp()
  async resetPin(
    @CurrentUser() actor: JwtPayload,
    @Param('id', ParseUUIDPipe) targetUserId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    const result = await this.authService.adminResetPin(targetUserId, actor.sub);
    await this.auditLog.record({
      actorUserId: actor.sub,
      actorRole: actor.userType,
      action: 'user.pin_reset',
      entityType: 'user',
      entityId: targetUserId,
      // **الكود نفسه مش بيتكتب في السجل** — سجل التدقيق بيتقرا من شاشة، وكتابة credential حي
      // فيه بيحوّل السجل لمكان تسريب. اللي بيتسجّل هو إن الإجراء حصل وإمتى بيموت التصريح.
      newValues: { pin_cleared: true, sessions_revoked: true, reset_code_expires_at: result.expires_at },
      meta: audit,
    });
    return result;
  }
}
