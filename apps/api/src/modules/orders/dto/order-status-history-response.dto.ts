import { OrderStatusHistory } from '../entities/order-status-history.entity';

export interface OrderStatusHistoryResponseDto {
  id: string;
  previous_status: string | null;
  new_status: string;
  changed_by_user_id: string | null;
  changed_by_role: string | null;
  change_source: string;
  reason: string | null;
  created_at: string;
}

export function toOrderStatusHistoryResponseDto(entry: OrderStatusHistory): OrderStatusHistoryResponseDto {
  return {
    id: entry.id,
    previous_status: entry.previousStatus,
    new_status: entry.newStatus,
    changed_by_user_id: entry.changedByUserId,
    changed_by_role: entry.changedByRole,
    change_source: entry.changeSource,
    reason: entry.reason,
    created_at: entry.createdAt.toISOString(),
  };
}
