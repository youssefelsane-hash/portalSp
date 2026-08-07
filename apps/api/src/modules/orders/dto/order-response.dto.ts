import { Order } from '../entities/order.entity';

export interface OrderResponseDto {
  id: string;
  order_number: string;
  service_id: string;
  address_id: string;
  technician_id: string | null;
  order_type: string;
  order_status: string;
  problem_description: string | null;
  customer_notes: string | null;
  scheduled_at: string | null;
  estimated_price_cents: number | null;
  inspection_fee_cents: number;
  total_amount_cents: number;
  payment_status: string;
  placed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export function toOrderResponseDto(order: Order): OrderResponseDto {
  return {
    id: order.id,
    order_number: order.orderNumber,
    service_id: order.serviceId,
    address_id: order.addressId,
    technician_id: order.technicianId,
    order_type: order.orderType,
    order_status: order.orderStatus,
    problem_description: order.problemDescription,
    customer_notes: order.customerNotes,
    scheduled_at: order.scheduledAt ? order.scheduledAt.toISOString() : null,
    estimated_price_cents: order.estimatedPriceCents,
    inspection_fee_cents: order.inspectionFeeCents,
    total_amount_cents: order.totalAmountCents,
    payment_status: order.paymentStatus,
    placed_at: order.placedAt ? order.placedAt.toISOString() : null,
    cancelled_at: order.cancelledAt ? order.cancelledAt.toISOString() : null,
    created_at: order.createdAt.toISOString(),
  };
}
