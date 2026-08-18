import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException, ErrorCode } from '../exceptions/api.exception';
import { REQUIRE_STEP_UP_KEY } from '../decorators/require-step-up.decorator';
import { StepUpService } from '../../modules/auth/step-up.service';
import { AuthenticatedRequest } from '../../modules/auth/types/authenticated-request';
import { SecurityEventsService } from '../../modules/security/security-events.service';
import { SecurityEventSeverity, SecurityEventType } from '../../modules/security/entities/security-event.entity';

// نفس فلسفة PermissionsGuard بالحرف: مسجّل global، no-op لو مفيش @RequireStepUp على الـendpoint.
// العميل لازم يرفق X-Step-Up-Token (من POST /auth/webauthn/step-up/verify، صالح دقيقتين
// ومستهلك مرة واحدة — ADR-0011 §4).
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly stepUpService: StepUpService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(REQUIRE_STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.headers['x-step-up-token'];
    if (!token || Array.isArray(token)) {
      void this.recordDenial(request);
      throw new ApiException(ErrorCode.AUTH_006, 'العملية دي محتاجة تأكيد Passkey حديث', HttpStatus.FORBIDDEN);
    }

    const consumed = await this.stepUpService.consume(request.user.sub, token);
    if (!consumed) {
      void this.recordDenial(request);
      throw new ApiException(ErrorCode.AUTH_006, 'تأكيد الـPasskey منتهي أو مستخدم قبل كده — اعمل تأكيد جديد', HttpStatus.FORBIDDEN);
    }
    return true;
  }

  // WARNING بس (مش تصعيد صلاحيات بالضرورة — ممكن يكون مستخدم شرعي لسه ماعملش step-up). التكرار
  // بيتجمّع تلقائيًا (dedup في SecurityEventsService) فيبان في مركز الأمان لو بقى نمط مشبوه.
  private async recordDenial(request: AuthenticatedRequest): Promise<void> {
    await this.securityEvents.recordDenial({
      eventType: SecurityEventType.SENSITIVE_ACTION_DENIED,
      severity: SecurityEventSeverity.WARNING,
      actorUserId: request.user.sub,
      actorRole: request.user.userType,
      sessionId: null,
      ipAddress: request.ip ?? request.socket?.remoteAddress ?? null,
      action: `step_up:${request.method}:${request.route?.path ?? request.path}`,
      attemptedValue: null,
    });
  }
}
