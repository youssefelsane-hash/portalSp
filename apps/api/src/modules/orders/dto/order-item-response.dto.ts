import { OrderItem } from '../entities/order-item.entity';

export interface OrderItemResponseDto {
  id: string;
  item_type: string;
  name_ar: string;
  description: string | null;
  quantity: number;
  unit_name: string | null;
  unit_price_cents: number;
  total_price_cents: number;
  is_customer_approved: boolean;
  approved_at: string | null;
  created_at: string;
}

export function toOrderItemResponseDto(item: OrderItem): OrderItemResponseDto {
  return {
    id: item.id,
    item_type: item.itemType,
    name_ar: item.nameAr,
    description: item.description,
    quantity: Number(item.quantity),
    unit_name: item.unitName,
    unit_price_cents: item.unitPriceCents,
    total_price_cents: item.totalPriceCents,
    is_customer_approved: item.isCustomerApproved,
    approved_at: item.approvedAt ? item.approvedAt.toISOString() : null,
    created_at: item.createdAt.toISOString(),
  };
}
