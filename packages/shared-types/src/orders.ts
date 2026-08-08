// مطابق لـ apps/api/src/modules/orders/dto/order-response.dto.ts وentities/order.entity.ts
export type OrderStatus =
  | 'draft'
  | 'pending_payment'
  | 'searching_technician'
  | 'technician_assigned'
  | 'accepted'
  | 'technician_on_way'
  | 'technician_arrived'
  | 'in_progress'
  | 'awaiting_quote_approval'
  | 'work_completed'
  | 'awaiting_payment'
  | 'completed'
  | 'cancelled_by_customer'
  | 'cancelled_by_technician'
  | 'cancelled_by_system'
  | 'expired'
  | 'disputed'
  | 'refunded';

export interface OrderResponseDto {
  id: string;
  order_number: string;
  service_id: string;
  address_id: string;
  technician_id: string | null;
  order_type: string;
  order_status: OrderStatus;
  problem_description: string | null;
  customer_notes: string | null;
  scheduled_at: string | null;
  estimated_price_cents: number | null;
  inspection_fee_cents: number;
  discount_amount_cents: number;
  promo_code_id: string | null;
  total_amount_cents: number;
  payment_status: string;
  placed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export interface OrderStatusHistoryResponseDto {
  id: string;
  previous_status: OrderStatus | null;
  new_status: OrderStatus;
  changed_by_user_id: string | null;
  changed_by_role: string | null;
  change_source: string;
  reason: string | null;
  created_at: string;
}

export interface OrderDetailResponseDto extends OrderResponseDto {
  status_history: OrderStatusHistoryResponseDto[];
}
