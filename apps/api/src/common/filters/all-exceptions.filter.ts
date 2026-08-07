import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ApiEnvelope } from '../dto/api-response';
import { ErrorCode } from '../exceptions/api.exception';
import { RequestWithId } from '../middleware/request-context.middleware';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<RequestWithId>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttp ? exception.getResponse() : null;

    let code: string = ErrorCode.VAL_001;
    let message = 'حصل خطأ غير متوقع، حاول تاني';

    if (typeof body === 'object' && body !== null && 'code' in body) {
      code = String((body as Record<string, unknown>).code);
      message = String((body as Record<string, unknown>).message ?? message);
    } else if (typeof body === 'object' && body !== null && 'message' in body) {
      const rawMessage = (body as Record<string, unknown>).message;
      message = Array.isArray(rawMessage) ? rawMessage.join(', ') : String(rawMessage);
      code = ErrorCode.VAL_001;
    } else if (isHttp) {
      message = exception.message;
    }

    if (!isHttp) {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }

    const envelope: ApiEnvelope<null> = {
      success: false,
      data: null,
      meta: null,
      error: { code, message },
      request_id: req.requestId,
    };

    res.status(status).json(envelope);
  }
}
