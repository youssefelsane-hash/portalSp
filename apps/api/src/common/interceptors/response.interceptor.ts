import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiEnvelope, ApiMeta } from '../dto/api-response';
import { RequestWithId } from '../middleware/request-context.middleware';

interface PaginatedShape<T> {
  items: T;
  meta: ApiMeta;
}

function isPaginatedShape<T>(value: unknown): value is PaginatedShape<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'items' in value &&
    'meta' in (value as Record<string, unknown>)
  );
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<T>> {
    const req = context.switchToHttp().getRequest<RequestWithId>();

    return next.handle().pipe(
      map((payload) => {
        const paginated = isPaginatedShape<T>(payload);

        return {
          success: true,
          data: paginated ? (payload as unknown as PaginatedShape<T>).items : (payload ?? null),
          meta: paginated ? (payload as unknown as PaginatedShape<T>).meta : null,
          error: null,
          request_id: req.requestId,
        };
      }),
    );
  }
}
