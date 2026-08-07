import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException, ErrorCode } from '../exceptions/api.exception';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PermissionsService } from '../../modules/admin/permissions.service';
import { AuthenticatedRequest } from '../../modules/auth/types/authenticated-request';

// نفس فلسفة RolesGuard: مسجّل global، بس no-op لو مفيش @RequirePermission على الـ endpoint —
// يعني الغالبية العظمى من مسارات @Roles(ADMIN) العادية فضلت شغالة زي ما هي بالظبط، والصلاحية
// الدقيقة بتتفعّل بس على الأفعال الحساسة (فلوس، قرارات نهائية) اللي حطينا عليها الديكوريتور.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
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
      throw new ApiException(
        ErrorCode.AUTH_001,
        'دورك الإداري مش مديك صلاحية العملية دي',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
