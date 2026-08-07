import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException, ErrorCode } from '../exceptions/api.exception';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserType } from '../../modules/auth/entities/user.entity';
import { AuthenticatedRequest } from '../../modules/auth/types/authenticated-request';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredTypes = this.reflector.getAllAndOverride<UserType[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredTypes || requiredTypes.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!requiredTypes.includes(request.user.userType)) {
      throw new ApiException(ErrorCode.AUTH_001, 'مش مسموح لك تعمل العملية دي', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
