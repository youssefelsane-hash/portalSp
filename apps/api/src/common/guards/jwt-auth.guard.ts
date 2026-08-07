import { ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ApiException, ErrorCode } from '../exceptions/api.exception';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    return super.canActivate(context);
  }

  handleRequest<TUser>(err: unknown, user: TUser, info: { name?: string } | undefined): TUser {
    if (err || !user) {
      if (info?.name === 'TokenExpiredError') {
        throw new ApiException(ErrorCode.AUTH_002, 'انتهت صلاحية التوكن', HttpStatus.UNAUTHORIZED);
      }
      throw new ApiException(ErrorCode.AUTH_001, 'توكن غير صالح', HttpStatus.UNAUTHORIZED);
    }
    return user;
  }
}
