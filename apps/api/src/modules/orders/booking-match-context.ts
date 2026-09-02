import { createHash } from "node:crypto";
import { PreviewOrderDto } from "./dto/preview-order.dto";
import type { CreateOrderDto } from "./dto/create-order.dto";
import { BookingMatchSelectionMode } from "./entities/booking-match-preview.entity";

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

export function bookingMatchContextHash(
  dto: PreviewOrderDto,
  selectionMode: BookingMatchSelectionMode,
  technicianId: string,
): string {
  const payload = canonicalize({
    dto,
    selection_mode: selectionMode,
    technician_id: technicianId,
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** يحصر مدخلات إنشاء الطلب في الحقول التي أثرت فعليًا على السعر والمطابقة. */
export function bookingPreviewInputFromCreate(dto: CreateOrderDto): PreviewOrderDto {
  return {
    service_id: dto.service_id,
    address_id: dto.address_id,
    request_remote_quote: dto.request_remote_quote,
    booking_mode: dto.booking_mode,
    scheduled_at: dto.scheduled_at,
    scheduled_end_at: dto.scheduled_end_at,
    period_start: dto.period_start,
    period_end: dto.period_end,
    field_values: dto.field_values,
    addon_ids: dto.addon_ids,
    promo_code: dto.promo_code,
    building_code: dto.building_code,
    requested_technician_id: dto.requested_technician_id,
    requested_technician_company_id: dto.requested_technician_company_id,
    schedule_slot_id: dto.schedule_slot_id,
    standard_data_id: dto.standard_data_id,
    requested_units: dto.requested_units,
    warranty_plan_id: dto.warranty_plan_id,
    pricing_quantity: dto.pricing_quantity,
    duration_hours: dto.duration_hours,
  };
}
