import { OrderQuote } from '../entities/order-quote.entity';

export interface OrderQuoteResponseDto {
  id: string;
  order_id: string;
  version: number;
  source: string;
  status: string;
  amount_cents: number;
  diagnosis: string | null;
  scope_included: string | null;
  scope_excluded: string | null;
  estimated_duration_minutes: number | null;
  required_technicians: number | null;
  required_assistants: number | null;
  expected_min_cents: number | null;
  expected_max_cents: number | null;
  revision_reason: string | null;
  valid_until: string;
  created_at: string;
  customer_decided_at: string | null;
  admin_decided_at: string | null;
}

export function toOrderQuoteResponseDto(quote: OrderQuote): OrderQuoteResponseDto {
  return {
    id: quote.id,
    order_id: quote.orderId,
    version: quote.version,
    source: quote.source,
    status: quote.status,
    amount_cents: quote.amountCents,
    diagnosis: quote.diagnosis,
    scope_included: quote.scopeIncluded,
    scope_excluded: quote.scopeExcluded,
    estimated_duration_minutes: quote.estimatedDurationMinutes,
    required_technicians: quote.requiredTechnicians,
    required_assistants: quote.requiredAssistants,
    expected_min_cents: quote.expectedMinCents,
    expected_max_cents: quote.expectedMaxCents,
    revision_reason: quote.revisionReason,
    valid_until: quote.validUntil.toISOString(),
    created_at: quote.createdAt.toISOString(),
    customer_decided_at: quote.customerDecidedAt?.toISOString() ?? null,
    admin_decided_at: quote.adminDecidedAt?.toISOString() ?? null,
  };
}
