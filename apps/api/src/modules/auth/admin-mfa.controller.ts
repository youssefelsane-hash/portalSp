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
}
