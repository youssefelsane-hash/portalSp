/**
 * تعريفات المقاييس — **المكان الوحيد** اللي بيقول «إيه اللي بنعتبره إيراد؟ إيه الطلب المكتمل؟
 * إيه العميل الراجع؟» (ADR-0081 §2).
 *
 * ليه الملف ده موجود أصلاً: قبله كان `admin-reports.service.ts` بيكتب شظية الإيراد بنفسه، وأي
 * شاشة جديدة كانت هتكتب نسختها. أول ما حد يعدّل واحدة منهم بيبقى في المنتج رقمين للإيراد
 * بيفرقوا في صمت. المشروع عنده تلات بَقّات موثّقة من الفئة دي (عدّادات مجمّدة على أصفار).
 *
 * الملف نقي عمدًا — مفيش `@Injectable` ولا استيراد من Nest — فأي موديول يقدر يستورده من غير
 * دورة استيراد. نفس أسلوب `common/rbac/effective-permissions.ts`.
 */

/** حالات الطلب اللي بتعتبر «شغل خلص فعلاً». */
export const COMPLETED_ORDER_STATUSES = ['completed'] as const;

/** حالات الإلغاء بكل أشكالها — بتدخل في مقام معدّل الإلغاء. */
export const CANCELLED_ORDER_STATUSES = [
  'cancelled_by_customer',
  'cancelled_by_technician',
  'cancelled_by_system',
  'expired',
] as const;

/**
 * حالات الدفع اللي بتعتبر «الفلوس اتحصّلت». `refunded` جوّه القايمة عن قصد: الطلب اتدفع فعلاً
 * وبعدين اترد — استبعاده كان هيخفي المعاملة من GMV بدل ما يظهرها مع الاسترداد اللي قابلها.
 */
export const SETTLED_PAYMENT_STATUSES = ['paid', 'partially_refunded', 'refunded'] as const;

/**
 * صافي عمولة المنصة لطلب: العمولة المسجّلة **ناقص** الجزء اللي اترجع منها في أي استرداد.
 * من غير الطرح ده، الإيراد بيفضل عالي بعد الاستردادات — وده أخطر رقم غلط ممكن يتعرض على
 * صاحب الشركة لأنه بيخلّي شهر خسران يبان رابح.
 *
 * بتتحط جوّه `SUM(...)` وبتفترض إن جدول الطلبات مستعار `o`.
 */
export const NET_PLATFORM_COMMISSION_SQL = `(o.platform_commission_cents - COALESCE((
  SELECT SUM(rsr.reversal_cents) FROM refund_settlement_reversals rsr
  WHERE rsr.order_id = o.id AND rsr.bucket_type = 'platform'
), 0))`;

/** صافي أرباح المشاركين (الفني + الطاقم) بنفس منطق الطرح. */
export const NET_PARTICIPANT_EARNINGS_SQL = `(o.technician_earning_cents - COALESCE((
  SELECT SUM(rsr.reversal_cents) FROM refund_settlement_reversals rsr
  WHERE rsr.order_id = o.id AND rsr.bucket_type = 'participant'
), 0))`;

/**
 * GMV = قيمة الشغل اللي عدّى على المنصة (إجمالي الطلبات المدفوعة)، مش دخل الشركة.
 * الفرق بين ده وبين `Revenue` هو أكتر حاجة بتتخلط في لوحات القيادة: GMV بيقيس الحجم،
 * والإيراد بيقيس دخلنا إحنا (العمولة).
 */
export const GMV_SQL = `o.total_amount_cents`;

/**
 * **دقايق الشغل لطلب واحد** — تعريف واحد لكل لوحة بتقيس الاستغلال (ADR-0081 §2).
 *
 * الترتيب مقصود ومطابق لمسطرة القدرة اليومية في `technician-day-capacity.sql.ts`: القيمة اللي
 * محرك التسعير طلّعها (`duration_minutes`) هي اللي المطابقة بتحجز بيها فعلاً، فلازم تكون هي
 * نفسها اللي الاستغلال بيتقاس بيها — وإلا اللوحة تقول الفني فاضي والمحرك يقول مليان.
 *
 * `duration_hours * 60` في النص مش زيادة تجميلية: قبل ما تتضاف هنا كان الاستغلال بيقرا
 * `COALESCE(duration_minutes, actual_duration_minutes, 0)` بس، فأي طلب متسعّر بالساعة (وده
 * قالب كامل في المحرك) كان بيتحسب **صفر دقيقة** ويقلّل الاستغلال المعروض من غير ما حد ياخد باله.
 *
 * `actual_duration_minutes` آخر خيار: هي بتتسجّل بعد التنفيذ بس، فالطلب اللي لسه شغّال ماكانش
 * ليه أي قيمة من غيرها.
 */
export function orderWorkedMinutesSql(alias = 'o'): string {
  return `COALESCE(${alias}.duration_minutes, ${alias}.duration_hours * 60, ${alias}.actual_duration_minutes, 0)`;
}

/** نافذة «العميل الراجع» — طلب تاني خلال المدة دي من الأول. */
export const REPEAT_WINDOW_DAYS = 90;

/** المنطقة الزمنية التشغيلية — كل تجميع يومي بيتقسّم بيها مش بـUTC. */
export const OPERATING_TIMEZONE = 'Africa/Cairo';

/**
 * حالات الطلب اللي بتعتبر «شغّال دلوقتي» — مستوردة كنسخة واحدة عشان تقارير الأدمن ولوحة
 * الإحصائيات مايفترقوش في تعريف «نشط».
 */
export const ACTIVE_ORDER_STATUSES = [
  'searching_technician',
  'technician_assigned',
  'accepted',
  'technician_on_way',
  'technician_arrived',
  'in_progress',
  'awaiting_quote_approval',
  'work_completed',
  'awaiting_payment',
] as const;

/**
 * «الطلب اتعيّنله فني» — أي حالة من دول تثبت إن المطابقة نجحت. لازم تفضل مطابقة لـ
 * `ASSIGNED_STATUSES` في `funnel.service.ts` (نفس السؤال بالظبط).
 */
export const ASSIGNED_ORDER_STATUSES = [
  'technician_assigned',
  'accepted',
  'technician_on_way',
  'technician_arrived',
  'in_progress',
  'work_completed',
  'awaiting_payment',
  'completed',
] as const;
