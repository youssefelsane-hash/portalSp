import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { RequestMetricsService } from './request-metrics.service';

/**
 * بيغذّي `RequestMetricsService` من **كل** طلب — الناجح والفاشل.
 *
 * `tap({ next, error })` مقصود: مسار الخطأ **مابيعديش** على `next`، فالاكتفاء بيه كان هيخلّي
 * أهم رقم في المراقبة (الـ5xx) صفر دايمًا — إنذار مطمئن وكاذب، وده أسوأ من مفيش إنذار.
 *
 * المسار بيتسجّل من `route.path` (النمط، مثلاً `/orders/:id`) مش من الـURL الفعلي — الـURL فيه
 * معرّفات، والتجميع عليه بيولّد آلاف المفاتيح ويخفي إن ٥٠٠ خطأ كلهم على نفس النقطة.
 */
@Injectable()
export class RequestMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: RequestMetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { route?: { path?: string } }>();
    const res = http.getResponse<Response>();
    const startedAt = Date.now();
    const route = `${req.method} ${req.route?.path ?? req.path ?? 'unknown'}`;

    const finish = (status: number): void => {
      this.metrics.record(status, Date.now() - startedAt, route);
    };

    return next.handle().pipe(
      tap({
        next: () => finish(res.statusCode),
        error: (err: unknown) => {
          const status = (err as { status?: number; getStatus?: () => number })?.getStatus?.() ??
            (err as { status?: number })?.status ??
            500;
          finish(status);
        },
      }),
    );
  }
}
