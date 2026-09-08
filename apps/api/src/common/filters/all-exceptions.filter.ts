import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Response } from 'express';
import { ApiEnvelope } from '../dto/api-response';
import { ErrorCode } from '../exceptions/api.exception';
import { RequestWithId } from '../middleware/request-context.middleware';
import { recordError } from './error-journal';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<RequestWithId>();

    const isHttp = exception instanceof HttpException;
    let status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttp ? exception.getResponse() : null;

    let code: string = ErrorCode.VAL_001;
    let message = 'حصل خطأ غير متوقع، حاول تاني';

    if (exception instanceof ThrottlerException || status === HttpStatus.TOO_MANY_REQUESTS) {
      code = ErrorCode.RATE_001;
      message = 'حاولت كتير في وقت قصير — استنى دقيقة وجرّب تاني';
      // Nest throttler لا يضمن Retry-After في كل adapter/version؛ نرجعه صراحة بعقد ثابت.
      res.setHeader('Retry-After', '60');
    } else if (this.isDatabaseBusy(exception)) {
      // انتهاء مهلة الـpool لا يعني أن الطلب غير صالح. 503 + Retry-After يقول للعميل إن إعادة
      // المحاولة آمنة، بعكس 500 المبهم الذي يدفعه للدوس المتكرر أو افتراض أن الحجز فشل.
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = ErrorCode.SYS_001;
      message = 'النظام مزحوم شوية دلوقتي — جرّب كمان شوية';
      res.setHeader('Retry-After', '5');
    } else if (typeof body === 'object' && body !== null && 'code' in body) {
      code = String((body as Record<string, unknown>).code);
      message = String((body as Record<string, unknown>).message ?? message);
    } else if (typeof body === 'object' && body !== null && 'message' in body) {
      const rawMessage = (body as Record<string, unknown>).message;
      message = Array.isArray(rawMessage) ? rawMessage.join(', ') : String(rawMessage);
      code = ErrorCode.VAL_001;
    } else if (isHttp) {
      message = exception.message;
    }

    message = this.toCustomerMessage(message, status);

    if (!isHttp) {
      // **العطل ده لازم يبقى قابل للتتبّع من الشاشة للوج في خطوة واحدة.**
      //
      // بلاغ مالك: «بيظهر خطأ غير متوقع… والتيرمنال مش ظاهر فيها الـerror». السطر القديم كان
      // بيطبع الـstack بس — بلا مسار ولا مستخدم ولا `request_id`، فمستحيل تربط الرسالة اللي
      // على الموبايل بسطر في لوج فيه آلاف السطور. دلوقتي السطر بيبدأ بنفس الـ`request_id` اللي
      // بيظهر في التطبيق، فـ`grep <request_id> .dev-logs/api.log` بيوصل للسبب فورًا.
      const actor = (req as { user?: { sub?: string } }).user?.sub ?? null;
      this.logger.error(
        `${status} [${req.requestId}] ${req.method} ${req.originalUrl} — مستخدم: ${actor ?? 'مجهول'}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // ومعاه سجل مخصّص على القرص: اللوج على الشاشة بيضيع، والكود اللي المستخدم شايفه لازم
      // يوصل لسببه حتى بعد ما التيرمنال يتقفل (`node scripts/find-error.js <كود>`).
      recordError({
        requestId: req.requestId,
        method: req.method,
        url: req.originalUrl,
        userId: actor,
        message: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? (exception.stack ?? null) : null,
      });
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

  private isDatabaseBusy(exception: unknown): boolean {
    const error = exception as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
    const code = error?.code ?? error?.cause?.code ?? '';
    const message = `${error?.message ?? ''} ${error?.cause?.message ?? ''}`.toLowerCase();
    return (
      ['ETIMEDOUT', 'ECONNRESET', '53300', '57P03'].includes(code) ||
      /timeout.*connect|connection.*timeout|too many clients|remaining connection slots|connection terminated/.test(message)
    );
  }

  private toCustomerMessage(message: string, status: number): string {
    // الرسائل التي تكتبها الخدمات بالعربية هي مصدر الحقيقة ولا نلمسها.
    if (/[\u0600-\u06FF]/.test(message)) return message;
    const normalized = message.toLowerCase();
    if (normalized.includes('uuid')) return 'اللينك ده مش صحيح أو قديم';
    if (status === HttpStatus.BAD_REQUEST) return 'البيانات المرسلة غير صحيحة';
    if (status === HttpStatus.NOT_FOUND) return 'المطلوب غير موجود أو لم يعد متاحًا';
    if (status === HttpStatus.FORBIDDEN) return 'مش مسموح لك تعمل العملية دي';
    if (status === HttpStatus.UNAUTHORIZED) return 'سجّل دخولك تاني وحاول';
    return 'حصل خطأ غير متوقع، حاول تاني';
  }
}
