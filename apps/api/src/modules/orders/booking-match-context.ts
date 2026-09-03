import { createHash } from "node:crypto";
import { PreviewOrderDto } from "./dto/preview-order.dto";
import type { CreateOrderDto } from "./dto/create-order.dto";
import { BookingMatchSelectionMode } from "./entities/booking-match-preview.entity";

/**
 * **الحقول اللي البصمة بتتحسب منها — قائمة واحدة صريحة، مش spread.**
 *
 * بَقّة حقيقية اتلقطت باختبار حي (بلاغ مالك 2026-09-03): مسار المعاينة كان بيعمل spread لكل
 * الـDTO اللي وصله، ومسار الإنشاء كان بيعدّد حقوله بإيده — فأي حقل موجود عند طرف وناقص عند
 * التاني بيدّي بصمتين مختلفتين وكل حجز بيترفض بـ«تفاصيل الحجز تغيّرت بعد المعاينة».
 *
 * ده اللي حصل مع `booking_mode` بالظبط: تطبيق العميل بيبعته في `POST /orders` ومابيبعتوش في
 * `POST /orders/match-preview`، والحقل ده **متجاهَل تمامًا في التسعير والمطابقة** (ADR-0048 —
 * الوضع مشتق من التاريخ وعدد العمال). يعني حقل ملوش أي تأثير حقيقي كان بيمنع كل الطلبات.
 *
 * القاعدة من دلوقتي: حقل يدخل البصمة **لو وبس لو** بيغيّر السعر أو المرشّح فعلاً. أي حقل
 * متجاهَل (`booking_mode`) مايدخلش. الطرفين بيمرّوا على نفس الدالة دي، فالانحراف بقى مستحيل
 * بنيويًا مش متروك للانتباه.
 */
const FINGERPRINT_FIELDS = [
  "service_id",
  "address_id",
  "request_remote_quote",
  "scheduled_at",
  "scheduled_end_at",
  "period_start",
  "period_end",
  "field_values",
  "addon_ids",
  "promo_code",
  "building_code",
  "requested_technician_id",
  "requested_technician_company_id",
  "schedule_slot_id",
  "standard_data_id",
  "requested_units",
  "warranty_plan_id",
  "pricing_quantity",
  "duration_hours",
] as const satisfies readonly (keyof PreviewOrderDto)[];

const DATE_FIELDS = new Set<string>([
  "scheduled_at",
  "scheduled_end_at",
  "period_start",
  "period_end",
]);

/**
 * التواريخ بتتقارن **كلحظة**، مش كنص.
 *
 * `@IsDateString()` بيقبل صيغ كتير لنفس اللحظة (`…T11:00:18Z` و`…T11:00:18.000Z` و
 * `…T14:00:18+03:00`)، والبصمة كانت بتتحسب على النص الخام — فاختلاف صيغة بين نداءين من نفس
 * التطبيق كان كفاية يبوّظ الحجز. القيمة اللي متقراش كتاريخ بتعدّي زي ما هي (التحقق مسؤول عنها).
 */
function normalizeDate(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map(canonicalize);
    return normalized.every((item) =>
      ["string", "number", "boolean"].includes(typeof item),
    )
      ? [...normalized].sort((a, b) => String(a).localeCompare(String(b)))
      : normalized;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

/** بيحصر أي مدخل في حقول البصمة بالظبط، بصرف النظر عن أي حقول تانية جاية معاه. */
export function bookingFingerprintInput(dto: PreviewOrderDto): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of FINGERPRINT_FIELDS) {
    const value = (dto as unknown as Record<string, unknown>)[field];
    if (value === undefined || value === null) continue;
    picked[field] = DATE_FIELDS.has(field) ? normalizeDate(value) : value;
  }
  return picked;
}

export function bookingMatchContextHash(
  dto: PreviewOrderDto,
  selectionMode: BookingMatchSelectionMode,
  technicianId: string,
): string {
  const payload = canonicalize({
    dto: bookingFingerprintInput(dto),
    selection_mode: selectionMode,
    technician_id: technicianId,
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * **بصمة الحجز بلا الفني** (ADR-0065 §4) — نفس الدالة فوق بالظبط بـ`technician_id` فاضي.
 *
 * `bookingMatchContextHash` بيدخل فيه الفني، فتذكرة لفني تاني بتديّ هاش مختلف بالضرورة —
 * مالوش لازمة لسؤال «هي دي نفس الشغلانة؟». البصمة دي هي اللي بتخلي إعادة اختيار المنفّذ تقدر
 * تثبت إن التذكرة الجديدة لنفس المدخلات، مش لحجز أرخص.
 *
 * `selection_mode` مستبعد كمان: العميل يقدر يعيد الاختيار يدويًا بعد ما كان تلقائي (والعكس)،
 * وده مش تغيير في الشغلانة نفسها.
 */
export function bookingContextHashWithoutProvider(dto: PreviewOrderDto): string {
  const payload = canonicalize({
    dto: bookingFingerprintInput({ ...dto, requested_technician_id: undefined }),
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** يحصر مدخلات إنشاء الطلب في الحقول التي أثرت فعليًا على السعر والمطابقة. */
export function bookingPreviewInputFromCreate(dto: CreateOrderDto): PreviewOrderDto {
  return bookingFingerprintInput(dto as unknown as PreviewOrderDto) as unknown as PreviewOrderDto;
}

/**
 * الحقول اللي اتغيّرت بين تذكرة المعاينة والإنشاء — عشان الرسالة تقول للعميل **إيه** اللي
 * اتغيّر بدل «تفاصيل الحجز تغيّرت» المبهمة. بترجع أسماء الحقول زي ما هي في العقد.
 */
export function bookingFingerprintDiff(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): string[] {
  const a = left;
  const b = right;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys]
    .filter(
      (key) =>
        JSON.stringify(canonicalize(a[key])) !== JSON.stringify(canonicalize(b[key])),
    )
    .sort();
}
