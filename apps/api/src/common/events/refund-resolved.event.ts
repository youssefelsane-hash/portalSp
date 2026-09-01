export const REFUND_RESOLVED_EVENT = 'refund.resolved';

export type RefundResolutionStatus = 'completed' | 'rejected';
export type RefundResolutionMethod = 'original_method' | 'wallet_credit' | 'cash';

export interface RefundResolvedEvent {
  refundId: string;
  orderId: string;
  orderNumber: string;
  customerProfileId: string;
  amountCents: number;
  status: RefundResolutionStatus;
  method: RefundResolutionMethod;
}
