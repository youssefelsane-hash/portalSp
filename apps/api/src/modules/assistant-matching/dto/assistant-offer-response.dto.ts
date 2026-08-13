export interface AssistantOfferListRow {
  offerId: string;
  orderId: string;
  orderNumber: string;
  serviceNameAr: string;
  problemDescription: string | null;
  streetName: string;
  landmark: string | null;
  expiresAt: Date;
}

export interface AssistantOfferResponseDto {
  offer_id: string;
  order_id: string;
  order_number: string;
  service_name_ar: string;
  problem_description: string | null;
  street_name: string;
  landmark: string | null;
  expires_at: string;
}

export function toAssistantOfferResponseDto(row: AssistantOfferListRow): AssistantOfferResponseDto {
  return {
    offer_id: row.offerId,
    order_id: row.orderId,
    order_number: row.orderNumber,
    service_name_ar: row.serviceNameAr,
    problem_description: row.problemDescription,
    street_name: row.streetName,
    landmark: row.landmark,
    expires_at: row.expiresAt.toISOString(),
  };
}
