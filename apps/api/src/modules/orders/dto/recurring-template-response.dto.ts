import { RecurringOrderTemplate } from '../entities/recurring-order-template.entity';

export interface RecurringTemplateResponseDto {
  id: string;
  service_id: string;
  address_id: string;
  booking_mode: string;
  requested_technician_id: string | null;
  frequency: string;
  problem_description: string | null;
  next_run_at: string;
  last_generated_order_id: string | null;
  is_active: boolean;
  created_at: string;
}

export function toRecurringTemplateResponseDto(template: RecurringOrderTemplate): RecurringTemplateResponseDto {
  return {
    id: template.id,
    service_id: template.serviceId,
    address_id: template.addressId,
    booking_mode: template.bookingMode,
    requested_technician_id: template.requestedTechnicianId,
    frequency: template.frequency,
    problem_description: template.problemDescription,
    next_run_at: template.nextRunAt.toISOString(),
    last_generated_order_id: template.lastGeneratedOrderId,
    is_active: template.isActive,
    created_at: template.createdAt.toISOString(),
  };
}
