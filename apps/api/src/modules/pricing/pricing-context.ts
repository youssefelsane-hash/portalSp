import { HttpStatus } from '@nestjs/common';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';

export const PRICING_CONTEXT_FIELD_KEYS = new Set([
  'quantity',
  'duration_minutes',
  'duration_hours',
  'scheduled_at_epoch_ms',
  'scheduled_end_at_epoch_ms',
  'is_emergency',
]);

const MAX_DURATION_MINUTES = 5 * 366 * 24 * 60;

export interface PricingContext {
  quantity: number | null;
  durationMinutes: number | null;
  durationHours: number | null;
  scheduledAt: Date | null;
  scheduledEndAt: Date | null;
  serviceFieldValues: Record<string, string | number | boolean>;
  numericFieldValues: Record<string, number>;
  zoneId: string | null;
  isEmergency: boolean;
  technicianLevel: string | null;
  bookingMode: string | null;
  addonIds: string[];
  recurringMetadata: Record<string, string | number | boolean>;
  businessVariables: Record<string, number>;
}

export interface BuildPricingContextInput {
  quantity?: number | null;
  durationHours?: number | null;
  scheduledAt?: string | Date | null;
  scheduledEndAt?: string | Date | null;
  serviceFieldValues?: Record<string, string | number | boolean>;
  zoneId?: string | null;
  isEmergency?: boolean;
  technicianLevel?: string | null;
  bookingMode?: string | null;
  addonIds?: string[];
  recurringMetadata?: Record<string, string | number | boolean>;
  businessVariables?: Record<string, number>;
}

function invalidDuration(message: string): never {
  throw new ApiException(ErrorCode.VAL_001, message, HttpStatus.BAD_REQUEST);
}

function parseDate(value: string | Date | null | undefined, label: string): Date | null {
  if (value === undefined || value === null) return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ApiException(ErrorCode.VAL_001, `${label} غير صالح`, HttpStatus.BAD_REQUEST);
  }
  return parsed;
}

function durationMinutesFromHours(hours: number | null | undefined): number | null {
  if (hours === undefined || hours === null) return null;
  if (!Number.isFinite(hours) || hours <= 0) {
    invalidDuration('مدة الخدمة لازم تكون أكبر من صفر');
  }
  const minutes = hours * 60;
  if (!Number.isSafeInteger(minutes)) {
    invalidDuration('مدة الخدمة لازم تتحدد بدقة دقائق كاملة');
  }
  return minutes;
}

export function buildPricingContext(input: BuildPricingContextInput): PricingContext {
  const scheduledAt = parseDate(input.scheduledAt, 'وقت بداية الخدمة');
  const scheduledEndAt = parseDate(input.scheduledEndAt, 'وقت نهاية الخدمة');
  if (scheduledEndAt && !scheduledAt) {
    invalidDuration('وقت نهاية الخدمة محتاج وقت بداية');
  }

  let intervalMinutes: number | null = null;
  if (scheduledAt && scheduledEndAt) {
    const differenceMs = scheduledEndAt.getTime() - scheduledAt.getTime();
    if (differenceMs <= 0) {
      invalidDuration('وقت النهاية لازم يكون بعد وقت البداية');
    }
    intervalMinutes = differenceMs / 60_000;
    if (!Number.isSafeInteger(intervalMinutes)) {
      invalidDuration('وقت البداية والنهاية لازم يحدد مدة بدقائق كاملة');
    }
  }

  const explicitMinutes = durationMinutesFromHours(input.durationHours);
  if (intervalMinutes !== null && explicitMinutes !== null && intervalMinutes !== explicitMinutes) {
    invalidDuration('المدة المرسلة لا تطابق الفرق بين وقت البداية والنهاية');
  }

  const durationMinutes = intervalMinutes ?? explicitMinutes;
  if (durationMinutes !== null && durationMinutes > MAX_DURATION_MINUTES) {
    invalidDuration('مدة الخدمة أكبر من الحد الآمن المسموح');
  }

  const quantity = input.quantity ?? null;
  if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) {
    throw new ApiException(ErrorCode.VAL_001, 'الكمية لازم تكون رقم أكبر من صفر', HttpStatus.BAD_REQUEST);
  }

  const serviceFieldValues = { ...(input.serviceFieldValues ?? {}) };
  const numericFieldValues = Object.fromEntries(
    Object.entries(serviceFieldValues)
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
      .map(([key, value]) => [key, value]),
  );

  return {
    quantity,
    durationMinutes,
    durationHours: durationMinutes === null ? null : durationMinutes / 60,
    scheduledAt,
    scheduledEndAt,
    serviceFieldValues,
    numericFieldValues,
    zoneId: input.zoneId ?? null,
    isEmergency: input.isEmergency ?? false,
    technicianLevel: input.technicianLevel ?? null,
    bookingMode: input.bookingMode ?? null,
    addonIds: [...(input.addonIds ?? [])],
    recurringMetadata: { ...(input.recurringMetadata ?? {}) },
    businessVariables: { ...(input.businessVariables ?? {}) },
  };
}

export function pricingContextFormulaValues(context: PricingContext): Record<string, number | boolean> {
  const values: Record<string, number | boolean> = {
    is_emergency: context.isEmergency,
  };
  if (context.quantity !== null) values.quantity = context.quantity;
  if (context.durationMinutes !== null) {
    values.duration_minutes = context.durationMinutes;
    values.duration_hours = context.durationMinutes / 60;
  }
  if (context.scheduledAt) values.scheduled_at_epoch_ms = context.scheduledAt.getTime();
  if (context.scheduledEndAt) values.scheduled_end_at_epoch_ms = context.scheduledEndAt.getTime();
  return { ...context.numericFieldValues, ...context.businessVariables, ...values };
}
