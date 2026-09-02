import { createHash } from "node:crypto";
import { PreviewOrderDto } from "./dto/preview-order.dto";
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
