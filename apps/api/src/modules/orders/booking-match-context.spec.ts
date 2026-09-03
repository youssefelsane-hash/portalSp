import {
  bookingFingerprintDiff,
  bookingFingerprintInput,
  bookingMatchContextHash,
} from "./booking-match-context";
import { PreviewOrderDto } from "./dto/preview-order.dto";

describe("bookingMatchContextHash", () => {
  it("is stable across object-key and addon ordering", () => {
    const first = {
      service_id: "10000000-0000-4000-8000-000000000001",
      address_id: "10000000-0000-4000-8000-000000000002",
      addon_ids: [
        "10000000-0000-4000-8000-000000000004",
        "10000000-0000-4000-8000-000000000003",
      ],
      field_values: { rooms: 3, furnished: true },
    } satisfies PreviewOrderDto;
    const sameMeaning = {
      address_id: first.address_id,
      service_id: first.service_id,
      field_values: { furnished: true, rooms: 3 },
      addon_ids: [...first.addon_ids].reverse(),
    } satisfies PreviewOrderDto;

    expect(bookingMatchContextHash(first, "auto", first.service_id)).toBe(
      bookingMatchContextHash(sameMeaning, "auto", first.service_id),
    );
  });

  it("changes when the selected provider or a pricing input changes", () => {
    const input = {
      service_id: "10000000-0000-4000-8000-000000000001",
      address_id: "10000000-0000-4000-8000-000000000002",
      pricing_quantity: 2,
    } satisfies PreviewOrderDto;

    const original = bookingMatchContextHash(
      input,
      "manual",
      "10000000-0000-4000-8000-000000000003",
    );
    expect(
      bookingMatchContextHash(
        { ...input, pricing_quantity: 3 },
        "manual",
        "10000000-0000-4000-8000-000000000003",
      ),
    ).not.toBe(original);
    expect(
      bookingMatchContextHash(
        input,
        "manual",
        "10000000-0000-4000-8000-000000000004",
      ),
    ).not.toBe(original);
  });

  /**
   * بَقّة حقيقية اتلقطت باختبار حي (بلاغ مالك 2026-09-03، docs/08 §121-ب): تطبيق العميل بيبعت
   * `booking_mode` في `POST /orders` ومابيبعتوش في `POST /orders/match-preview` — والحقل ده
   * **متجاهَل تمامًا** في التسعير والمطابقة (ADR-0048). النتيجة كانت بصمتين مختلفتين، فكل حجز
   * من مسار اختيار الفني بيترفض بـ«تفاصيل الحجز تغيّرت».
   */
  it("حقل متجاهَل (booking_mode) مايغيّرش البصمة", () => {
    const input = {
      service_id: "10000000-0000-4000-8000-000000000001",
      address_id: "10000000-0000-4000-8000-000000000002",
    } satisfies PreviewOrderDto;
    const tech = "10000000-0000-4000-8000-000000000003";

    expect(
      bookingMatchContextHash(
        { ...input, booking_mode: "individual" } as PreviewOrderDto,
        "auto",
        tech,
      ),
    ).toBe(bookingMatchContextHash(input, "auto", tech));
  });

  it("حقول برّه البصمة خالص (زي problem_description) مالهاش أي أثر", () => {
    const input = {
      service_id: "10000000-0000-4000-8000-000000000001",
      address_id: "10000000-0000-4000-8000-000000000002",
    } satisfies PreviewOrderDto;
    const tech = "10000000-0000-4000-8000-000000000003";

    expect(
      bookingMatchContextHash(
        { ...input, problem_description: "الحنفية بتنقّط" } as unknown as PreviewOrderDto,
        "manual",
        tech,
      ),
    ).toBe(bookingMatchContextHash(input, "manual", tech));
  });

  it("نفس اللحظة بصيغ تاريخ مختلفة = نفس البصمة", () => {
    const base = {
      service_id: "10000000-0000-4000-8000-000000000001",
      address_id: "10000000-0000-4000-8000-000000000002",
    } satisfies PreviewOrderDto;
    const tech = "10000000-0000-4000-8000-000000000003";

    const withMillis = bookingMatchContextHash(
      { ...base, scheduled_at: "2026-09-06T11:00:18.000Z" },
      "auto",
      tech,
    );
    const withoutMillis = bookingMatchContextHash(
      { ...base, scheduled_at: "2026-09-06T11:00:18Z" },
      "auto",
      tech,
    );
    const otherOffset = bookingMatchContextHash(
      { ...base, scheduled_at: "2026-09-06T14:00:18+03:00" },
      "auto",
      tech,
    );

    expect(withoutMillis).toBe(withMillis);
    expect(otherOffset).toBe(withMillis);
  });

  it("لحظة مختلفة فعلاً بتغيّر البصمة", () => {
    const base = {
      service_id: "10000000-0000-4000-8000-000000000001",
      address_id: "10000000-0000-4000-8000-000000000002",
    } satisfies PreviewOrderDto;
    const tech = "10000000-0000-4000-8000-000000000003";

    expect(
      bookingMatchContextHash({ ...base, scheduled_at: "2026-09-06T12:00:18Z" }, "auto", tech),
    ).not.toBe(
      bookingMatchContextHash({ ...base, scheduled_at: "2026-09-06T11:00:18Z" }, "auto", tech),
    );
  });

  it("الفرق بيرجّع أسماء الحقول اللي اتغيّرت فعلاً — دي اللي بتوصل للعميل في الرسالة", () => {
    const before = bookingFingerprintInput({
      service_id: "10000000-0000-4000-8000-000000000001",
      address_id: "10000000-0000-4000-8000-000000000002",
    } satisfies PreviewOrderDto);
    const after = bookingFingerprintInput({
      service_id: "10000000-0000-4000-8000-000000000001",
      address_id: "10000000-0000-4000-8000-000000000002",
      requested_units: 3,
      booking_mode: "individual",
    } as PreviewOrderDto);

    // `booking_mode` مش في القايمة أصلاً، فمش هيبان في الفرق.
    expect(bookingFingerprintDiff(before, after)).toEqual(["requested_units"]);
  });
});
