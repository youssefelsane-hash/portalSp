import { RecurringOrderTemplate } from '../entities/recurring-order-template.entity';
import { AdminRecurringPlanRow } from '../recurring-orders.service';

export interface RecurringTemplateResponseDto {
  id: string;
  service_id: string;
  address_id: string;
  booking_mode: string;
  requested_technician_id: string | null;
  requested_technician_company_id: string | null;
  // انتماء العمارة (migration 0257، docs/08 §122) — العميل شايف إنه لسه مربوط بالعمارة بلا
  // أي رقم خصم (نسبة الخصم بتتحسب فريش وقت كل نوبة، مش بتتخزن هنا).
  building_id: string | null;
  frequency: string;
  problem_description: string | null;
  payment_method: 'card' | 'instapay' | null;
  // مدخلات التسعير/التوقيت المتكررة (migration 0176) — مدخلات مش سعر، القيمة بتتحسب وقت توليد
  // كل طلب من محرك التسعير الحي.
  field_values: Record<string, string | number | boolean> | null;
  pricing_quantity: number | null;
  duration_hours: number | null;
  duration_minutes: number | null;
  scheduled_end_at: string | null;
  next_run_at: string;
  last_generated_order_id: string | null;
  is_active: boolean;
  created_at: string;
  // موثوقية التوليد (docs/08 §19 بند 20) — consecutive_failure_count بيرجع صفر بمجرد نجاح توليد
  // أو بمجرد ما نوبة فشل توصل للسقف وتتخطّى (dead-letter) — راجع RecurringOrdersService.recordFailure().
  consecutive_failure_count: number;
  last_failure_reason: string | null;
  last_failed_at: string | null;
}

export function toRecurringTemplateResponseDto(template: RecurringOrderTemplate): RecurringTemplateResponseDto {
  return {
    id: template.id,
    service_id: template.serviceId,
    address_id: template.addressId,
    booking_mode: template.bookingMode,
    requested_technician_id: template.requestedTechnicianId,
    requested_technician_company_id: template.requestedTechnicianCompanyId,
    building_id: template.buildingId,
    frequency: template.frequency,
    problem_description: template.problemDescription,
    payment_method: template.paymentMethod,
    field_values: template.fieldValues,
    pricing_quantity: template.pricingQuantity == null ? null : Number(template.pricingQuantity),
    duration_hours: template.durationHours,
    duration_minutes: template.durationMinutes ?? (template.durationHours == null ? null : template.durationHours * 60),
    scheduled_end_at: template.scheduledEndAt ? template.scheduledEndAt.toISOString() : null,
    next_run_at: template.nextRunAt.toISOString(),
    last_generated_order_id: template.lastGeneratedOrderId,
    is_active: template.isActive,
    created_at: template.createdAt.toISOString(),
    consecutive_failure_count: template.consecutiveFailureCount,
    last_failure_reason: template.lastFailureReason,
    last_failed_at: template.lastFailedAt ? template.lastFailedAt.toISOString() : null,
  };
}

// نسخة الأدمن — صف مُثرى من listAllForAdmin() (JOIN جاهز بأسماء العميل/الخدمة/العنوان وآخر
// حجز متولّد) — دي "خطة الحجز المتكرر" نفسها؛ الطلبات المتولّدة منه بتتشاف من /admin/orders.
export interface AdminRecurringPlanResponseDto {
  id: string;
  customer_id: string;
  customer_full_name: string;
  customer_phone: string;
  service_id: string;
  service_name_ar: string;
  address_id: string;
  address_label: string | null;
  booking_mode: string;
  building_id: string | null;
  building_code: string | null;
  building_name_ar: string | null;
  frequency: string;
  payment_method: 'card' | 'instapay' | null;
  next_run_at: string;
  last_generated_order_id: string | null;
  last_order_number: string | null;
  last_occurrence_at: string | null;
  is_active: boolean;
  created_at: string;
  cancelled_at: string | null;
  consecutive_failure_count: number;
  last_failure_reason: string | null;
  last_failed_at: string | null;
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString();

export function toAdminRecurringPlanResponseDto(row: AdminRecurringPlanRow): AdminRecurringPlanResponseDto {
  return {
    id: row.id,
    customer_id: row.customer_id,
    customer_full_name: row.customer_full_name,
    customer_phone: row.customer_phone,
    service_id: row.service_id,
    service_name_ar: row.service_name_ar,
    address_id: row.address_id,
    address_label: row.address_label,
    booking_mode: row.booking_mode,
    building_id: row.building_id,
    building_code: row.building_code,
    building_name_ar: row.building_name_ar,
    frequency: row.frequency,
    payment_method: row.payment_method,
    next_run_at: iso(row.next_run_at)!,
    last_generated_order_id: row.last_generated_order_id,
    last_order_number: row.last_order_number,
    last_occurrence_at: iso(row.last_occurrence_at),
    is_active: row.is_active,
    created_at: iso(row.created_at)!,
    cancelled_at: iso(row.cancelled_at),
    consecutive_failure_count: Number(row.consecutive_failure_count),
    last_failure_reason: row.last_failure_reason,
    last_failed_at: iso(row.last_failed_at),
  };
}
