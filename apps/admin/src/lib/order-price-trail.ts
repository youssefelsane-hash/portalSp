/**
 * **مسار تكوين سعر العميل** (ADR-0107) — مطابق للباك-إند بالحرف
 * (`apps/api/src/modules/orders/order-price-trail.ts`).
 *
 * مش في `@baytak/shared-types` لأنه endpoint أدمن-بس ضيّق، نفس قرار `ProductivityReport`.
 */
export interface PriceTrailStage {
  key:
    | 'engine_raw'
    | 'zone_adjustment'
    | 'pricing_tier_multiplier'
    | 'price_clamp'
    | 'inspection_fee'
    | 'emergency_surcharge'
    | 'addons'
    | 'warranty'
    | 'discount';
  label_ar: string;
  applied: boolean;
  amount_cents: number;
  running_total_cents: number;
  detail_ar: string | null;
}

export interface PostBookingPriceChange {
  key: 'level_premium' | 'additional_items' | 'instapay_discount' | 'assessment_fee_credit';
  label_ar: string;
  amount_cents: number;
  source_ar: string;
}

export interface OrderPriceTrail {
  order_id: string;
  formation_snapshot_available: boolean;
  stages: PriceTrailStage[];
  total_at_booking_cents: number;
  current_total_cents: number;
  post_booking: PostBookingPriceChange[];
  reconciles: boolean;
  unexplained_cents: number;
  notes_ar: string[];
}

/** المراحل اللي بتكوّن سعر الشغل نفسه — منفصلة عن الرسوم في العرض. */
export const FORMATION_STAGE_KEYS: PriceTrailStage['key'][] = [
  'engine_raw',
  'zone_adjustment',
  'pricing_tier_multiplier',
  'price_clamp',
];
