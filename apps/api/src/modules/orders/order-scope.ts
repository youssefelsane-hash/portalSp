import { OrderStatus } from './entities/order.entity';

/**
 * **نطاق الطلبات وتعريف «النهائي» — مصدر حقيقة واحد** (ADR-0103، docs/08 §157).
 *
 * بلاغ المالك: «لو دوست على الطلبات اللي موعد تنفيذها قرب، بيجيبلي طلبات مكتملة وتنفيذها عدى
 * من أسبوعين… بيجيبلي أول طلب في السيستم».
 *
 * السبب إن `sort=soonest` كان **ORDER BY وبس** بلا أي فلترة حالة، فالـsort بقى بيعرّف معنى
 * الصفحة. الملف ده بيفصل المحورين: `scope` بيجاوب «إيه اللي عايز أشوفه؟» و`sort` بيجاوب
 * «أرتبه إزاي؟».
 *
 * الدوال هنا **خالصة** عشان الفلترة والعدّ والملخّص والتقويم كلهم يقروا نفس التعريف — أي نسخة
 * تانية من «إيه النهائي» بتخلّي الملخّص يقول رقم والقايمة تعرض غيره.
 */

/**
 * **الحالات النهائية** — الطلب خلص ومش محتاج أي إجراء تشغيلي.
 *
 * ⚠️ الغايبين هنا مقصودين:
 *  - `DISPUTED` — نزاع مفتوح محتاج قرار أدمن. أقرب حاجة لـ«عاجل»، مستحيل تبقى history.
 *  - `WORK_COMPLETED` / `AWAITING_PAYMENT` — الشغل خلص بس **الفلوس ماتحصّلتش**. لسه تشغيل.
 *  - `AWAITING_TECHNICIAN_RESELECTION` / `AWAITING_TECHNICIAN_SELECTION` — مستنية العميل.
 */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_TECHNICIAN,
  OrderStatus.CANCELLED_BY_SYSTEM,
  OrderStatus.EXPIRED,
  OrderStatus.REFUNDED,
];

const TERMINAL_SET: ReadonlySet<OrderStatus> = new Set(TERMINAL_ORDER_STATUSES);

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return TERMINAL_SET.has(status);
}

/** الحالات **غير** النهائية — «الحالية» بالتعريف. */
export const ACTIVE_ORDER_SCOPE_STATUSES: readonly OrderStatus[] = Object.values(OrderStatus).filter(
  (status) => !TERMINAL_SET.has(status),
);

export type OrderScope = 'current' | 'completed' | 'all';

/** الحقل اللي `from`/`to` بيتطبّقوا عليه — «عايز أشوف ٢٠–٣٠ سبتمبر» سؤال ناقص من غيره. */
export type OrderDateField = 'scheduled_at' | 'placed_at' | 'completed_at';

/**
 * اختصارات تشغيلية جوّه الـscope. **مشتقّة كلها** — مفيش `OrderStatus` جديد ولا عمود جديد.
 *
 * `overdue` بالتحديد: الموعد عدّى والطلب لسه non-terminal. طلب المالك بالحرف: «مش محتاجين
 * نخترع Order Status جديد».
 */
export type OrderBucket = 'today' | 'tomorrow' | 'next7' | 'upcoming' | 'overdue' | 'unassigned';

/** أسماء الأعمدة الحقيقية لكل حقل تاريخ — نقطة الترجمة الوحيدة. */
export const ORDER_DATE_COLUMNS: Record<OrderDateField, string> = {
  // `placed_at` عمود nullable، فبنرجع لـ`created_at` — نفس قاعدة ترتيب القايمة بالحرف
  // (`COALESCE(placed_at, created_at)`)، وإلا الطلب اللي مالوش `placed_at` يختفي من أي نطاق.
  placed_at: 'COALESCE(o.placed_at, o.created_at)',
  scheduled_at: 'o.scheduled_at',
  completed_at: 'o.work_completed_at',
};

/**
 * الحالات اللي الـscope بيسمح بيها. `null` = مفيش قيد (كل الطلبات).
 *
 * ملاحظة: `completed` بتضم **كل** الحالات النهائية (ملغي/منتهي/مسترد كمان) مش `COMPLETED` بس —
 * لأن الغرض «History منفصل» بنص المالك، والملغي history زيه زي المكتمل. الأدمن بيضيّق أكتر
 * بفلتر الحالة لو عايز.
 */
export function statusesForScope(scope: OrderScope): readonly OrderStatus[] | null {
  if (scope === 'current') return ACTIVE_ORDER_SCOPE_STATUSES;
  if (scope === 'completed') return TERMINAL_ORDER_STATUSES;
  return null;
}
