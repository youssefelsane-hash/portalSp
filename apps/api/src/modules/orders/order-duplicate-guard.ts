import { createHash } from 'crypto';
import { CreateOrderDto } from './dto/create-order.dto';

/** نافذة الحماية الافتراضية بالثواني — القيمة الحقيقية من `settings`. */
export const DUPLICATE_GUARD_WINDOW_SECONDS_FALLBACK = 90;

/** مفتاح الـidempotency في `orders` طوله `VARCHAR(80)` (migration 0139) — بنفضل تحته بأمان. */
const HASH_LENGTH = 40;

/**
 * **حماية الدوسة المزدوجة على إنشاء الطلب** (تدقيق `docs/29` P0-4).
 *
 * `Idempotency-Key` موجود من migration 0139 وشغّال صح — بس **اختياري**. أي كلاينت مش بيبعته
 * (نسخة تطبيق قديمة، متصفح، تكامل خارجي) بيفضل مكشوف تمامًا: اتأكد حيًا إن طلبين متوازيين
 * بنفس الـbody بالظبط بيعملوا **طلبين مختلفين**.
 *
 * والمشكلة بتتضاعف مع الضغط: العميل اللي بيستنى رد بطيء بيفتكر إن التطبيق علّق **فيدوس تاني**.
 *
 * الحل هنا: لما الكلاينت ما يبعتش مفتاح، السيرفر **يشتق واحد بنفسه** من هوية الطلب المنطقية
 * (العميل + كل حقول الـDTO) + شريحة زمنية قصيرة. النتيجة:
 *
 * - دوستين على نفس الزرار خلال النافذة ⇒ نفس المفتاح ⇒ العميل بياخد **طلبه الأصلي** (مش خطأ،
 *   ومش طلب تاني).
 * - أي اختلاف حقيقي في الطلب (خدمة، عنوان، معاد، وصف المشكلة، كمية…) ⇒ هاش مختلف ⇒ طلب جديد
 *   عادي. الوصف الحر داخل في الهاش عمدًا — هو أقوى مميّز بين شغلانتين مختلفتين في نفس البيت.
 * - بعد انتهاء النافذة ⇒ شريحة جديدة ⇒ العميل يقدر يطلب نفس الحاجة تاني عادي.
 *
 * **ليه شريحتين مش واحدة**: لو الدوستين وقعوا على حدّي شريحتين متجاورتين، مفتاح كل واحدة
 * هيبقى مختلف والحماية تضيع. عشان كده الفحص بيدوّر على الشريحة الحالية **والسابقة**، والكتابة
 * بتبقى بالحالية. كده الثغرة دي مقفولة عمليًا بدل ما تسيب ٪٠٫٢ من الحالات تعدّي.
 */
export function autoIdempotencyKeys(
  customerId: string,
  dto: CreateOrderDto,
  nowMs: number,
  windowSeconds: number,
): [current: string, previous: string] {
  const windowMs = Math.max(1, Math.floor(windowSeconds)) * 1000;
  const bucket = Math.floor(nowMs / windowMs);
  const fingerprint = stableFingerprint(customerId, dto);
  return [`auto:${bucket}:${fingerprint}`, `auto:${bucket - 1}:${fingerprint}`];
}

/**
 * بصمة ثابتة للطلب. **الترتيب لازم يبقى حتمي** — `JSON.stringify` لوحده بيتبع ترتيب إدخال
 * المفاتيح، وده بيختلف بين نسخ الكلاينت فيطلع هاش مختلف لنفس الطلب بالظبط وتضيع الحماية.
 */
function stableFingerprint(customerId: string, dto: CreateOrderDto): string {
  return createHash('sha256').update(`${customerId}|${canonicalize(dto)}`).digest('hex').slice(0, HASH_LENGTH);
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${k}:${canonicalize(v)}`).join(',')}}`;
  }
  return String(value);
}
