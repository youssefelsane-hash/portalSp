import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException, ErrorCode } from '../exceptions/api.exception';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { MFA_REQUIRED_PERMISSIONS } from '../../modules/auth/mfa-policy.service';
import { PermissionsService } from '../../modules/admin/permissions.service';
import { AuthenticatedRequest } from '../../modules/auth/types/authenticated-request';
import { SecurityEventsService } from '../../modules/security/security-events.service';
import { SecurityEventSeverity, SecurityEventType } from '../../modules/security/entities/security-event.entity';

const SENSITIVE_PERMISSIONS = new Set<string>([...MFA_REQUIRED_PERMISSIONS, 'roles.grant_unrestricted']);

// نفس فلسفة RolesGuard: مسجّل global، بس no-op لو مفيش @RequirePermission على الـ endpoint —
// يعني الغالبية العظمى من مسارات @Roles(ADMIN) العادية فضلت شغالة زي ما هي بالظبط، والصلاحية
// الدقيقة بتتفعّل بس على الأفعال الحساسة (فلوس، قرارات نهائية) اللي حطينا عليها الديكوريتور.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPermission) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const hasPermission = await this.permissionsService.hasPermission(request.user.sub, requiredPermission);
    if (!hasPermission) {
      // تسجيل best-effort (Script 5 Part 4/8) — صفر تأثير على الـ403 اللي هيتّرمي فورًا بعده،
      // نفس فلسفة non-blocking recordDenial() (SecurityEventsService).
      void this.recordDenial(request, requiredPermission);
      throw new ApiException(
        ErrorCode.AUTH_001,
        'دورك الإداري مش مديك صلاحية العملية دي',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }

  private async recordDenial(request: AuthenticatedRequest, requiredPermission: string): Promise<void> {
    const params = request.params as Record<string, string | undefined>;
    const targetUserId = params?.userId ?? null;
    const isRbacMutation = requiredPermission === 'roles.manage' || requiredPermission === 'roles.grant_unrestricted';
    const isSelfTarget = targetUserId !== null && targetUserId === request.user.sub;

    let eventType = SecurityEventType.SENSITIVE_ACTION_DENIED;
    let severity = SecurityEventSeverity.INFO;
    if (isRbacMutation && isSelfTarget) {
      eventType = SecurityEventType.PRIVILEGE_ESCALATION_ATTEMPT;
      severity = SecurityEventSeverity.CRITICAL;
    } else if (isRbacMutation) {
      eventType = SecurityEventType.UNAUTHORIZED_ROLE_CHANGE;
      severity = SecurityEventSeverity.HIGH;
    } else if (SENSITIVE_PERMISSIONS.has(requiredPermission)) {
      severity = SecurityEventSeverity.HIGH;
    }

    await this.securityEvents.recordDenial({
      eventType,
      severity,
      actorUserId: request.user.sub,
      actorRole: request.user.userType,
      targetUserId,
      sessionId: null,
      ipAddress: request.ip ?? request.socket?.remoteAddress ?? null,
      action: requiredPermission,
      attemptedValue: null,
    });
  }
}
