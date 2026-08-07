import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestWithId } from '../middleware/request-context.middleware';

export interface AuditMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

// بيلمّ ip/user-agent/request_id من الـ request في نداء واحد — بيتحط في نهاية أي service
// method بيسجّل audit log، بدل ما كل controller يلمّهم يدوي كل مرة.
export const AuditContext = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuditMeta => {
  const request = ctx.switchToHttp().getRequest<RequestWithId>();
  return {
    ip: request.ip ?? request.socket?.remoteAddress ?? null,
    userAgent: request.headers['user-agent'] ?? null,
    requestId: request.requestId ?? null,
  };
});
