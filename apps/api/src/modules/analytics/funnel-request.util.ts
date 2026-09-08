import { HttpException } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * معرّف محاولة الحجز من هيدر `x-funnel-session` (ADR-0081 §3).
 *
 * **بيترفض أي حاجة مش UUID** بدل ما يتحفظ زي ما هو: العمود `uuid` في القاعدة، فقيمة غلط كانت
 * هترمي على مستوى القاعدة وتضيّع الحدث كله. كلاينت قديم مابيبعتش الهيدر بيرجع `null` —
 * الحدث بيتسجّل عادي وبيدخل في عدّاد المرحلة، بس مش في حساب التسرّب بين المراحل.
 */
export function resolveFunnelSession(header: string | undefined): string | null {
  const value = header?.trim();
  return value && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

/**
 * سبب الفشل كنص قصير قابل للتجميع — **مش رسالة الخطأ الكاملة**.
 *
 * السبب: العمود ده بيتجمّع بـ`GROUP BY` في تقرير «أكتر أسباب الفشل»، ورسالة فيها اسم خدمة أو
 * رقم أو تاريخ بتخلّي كل صف فريد فالتجميع بيبقى بلا معنى. وكمان رسايل الأخطاء ممكن تحتوي على
 * بيانات العميل، والجدول ده بيتقرا في لوحة تحليلات مش في سجل تشخيص.
 */
export function describeFunnelFailure(err: unknown): string {
  if (err instanceof ApiException) return err.code;
  if (err instanceof HttpException) return `http_${err.getStatus()}`;
  return 'internal_error';
}
