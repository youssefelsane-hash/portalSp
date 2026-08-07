import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';

export interface LoyaltyTransactionResponseDto {
  id: string;
  points_amount: number;
  direction: string;
  source: string;
  reference_id: string | null;
  balance_after: number;
  expires_at: string | null;
  created_at: string;
}

export function toLoyaltyTransactionResponseDto(transaction: LoyaltyTransaction): LoyaltyTransactionResponseDto {
  return {
    id: transaction.id,
    points_amount: transaction.pointsAmount,
    direction: transaction.direction,
    source: transaction.source,
    reference_id: transaction.referenceId,
    balance_after: transaction.balanceAfter,
    expires_at: transaction.expiresAt ? transaction.expiresAt.toISOString() : null,
    created_at: transaction.createdAt.toISOString(),
  };
}
