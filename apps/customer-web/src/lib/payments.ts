import { PaymentChannelDto } from './api-types';

export type { PaymentChannelDto };

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export const fetchPaymentChannels = (authedFetch: AuthedFetch) => authedFetch<PaymentChannelDto[]>('/payment-channels');

export interface PaymentResponseDto {
  id: string;
  payment_number: string;
  order_id: string;
  amount_cents: number;
  payment_method: string;
  payment_status: string;
  completed_at: string | null;
  order_item_batch_id: string | null;
}

export interface CardPaymentResponseDto {
  payment: PaymentResponseDto;
  redirect_url: string;
}

// كل عملية دفع لازم Idempotency-Key فريد (docs/01 §1.4) — منتج مرة واحدة لكل محاولة زرار،
// عشان أي إعادة إرسال (شبكة بطيئة، دبل-كليك) ماتعملش دفعتين لنفس الطلب.
export const payWithCard = (authedFetch: AuthedFetch, orderId: string) =>
  authedFetch<CardPaymentResponseDto>(`/orders/${orderId}/pay-with-card`, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
