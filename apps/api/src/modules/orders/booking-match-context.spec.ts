import { bookingMatchContextHash } from "./booking-match-context";
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
});
