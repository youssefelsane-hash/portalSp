import { apiFetch, apiFetchList } from './api-client';
import type { ApplicablePaymentPolicyDto, InstallmentPlanPublicDto } from '@baytak/shared-types';

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

// سياسات الدفع المطبقة على checkout خدمة معينة (migration 0177) — النسخة الحالية + نصها +
// إجباري أو لا. العرض في الواجهة، والتحقق النهائي من الباك-إند عند إنشاء الطلب.
export const fetchApplicablePolicies = (
  serviceId: string,
  appliesTo: 'postpaid_service' | 'installment' = 'postpaid_service',
): Promise<ApplicablePaymentPolicyDto[]> =>
  apiFetchList<ApplicablePaymentPolicyDto>(
    `/checkout/payment-policies?applies_to=${appliesTo}&service_id=${encodeURIComponent(serviceId)}`,
  );

export const fetchInstallmentPlans = (serviceId: string): Promise<InstallmentPlanPublicDto[]> =>
  apiFetchList<InstallmentPlanPublicDto>(`/installment-plans?service_id=${encodeURIComponent(serviceId)}`);

/** تقديم طلب تقسيط على طلب قائم — الباك-إند بيحسب كل المبالغ authoritative وبيرجع الـbreakdown. */
export const submitInstallmentApplication = (
  authedFetch: AuthedFetch,
  orderId: string,
  body: { plan_id: string; payment_method_id?: string; accepted_policy_version_ids: string[] },
): Promise<InstallmentApplicationDto> =>
  authedFetch<InstallmentApplicationDto>(`/orders/${orderId}/installment-application`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export interface InstallmentApplicationDto {
  id: string;
  order_id: string;
  status: 'pending_review' | 'approved' | 'rejected' | 'cancelled';
  service_price_cents: number;
  financing_fee_cents: number;
  total_financed_cents: number;
  down_payment_cents: number;
  financed_balance_cents: number;
  installment_count: number;
  regular_installment_cents: number;
  final_installment_cents: number;
}

export interface InstallmentRowDto {
  id: string;
  sequence_number: number;
  due_at: string;
  amount_cents: number;
  status: string;
  paid_at: string | null;
  overdue?: boolean;
}

export interface MyInstallmentsEntryDto {
  application: InstallmentApplicationDto;
  installments: InstallmentRowDto[];
  summary: {
    total_financed_cents: number;
    paid_cents: number;
    remaining_cents: number;
    next_installment: InstallmentRowDto | null;
    has_overdue: boolean;
  };
}

export const listMyInstallments = (authedFetch: AuthedFetch): Promise<MyInstallmentsEntryDto[]> =>
  authedFetch<MyInstallmentsEntryDto[]>('/me/installments');

export const cancelInstallmentApplication = (authedFetch: AuthedFetch, applicationId: string): Promise<void> =>
  authedFetch<void>(`/installment-applications/${applicationId}`, { method: 'DELETE' });
