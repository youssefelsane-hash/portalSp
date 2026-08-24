// مطابق لـ apps/api/src/modules/installments/dto — محرك التقسيط (migration 0177)

export interface InstallmentPlanPublicDto {
  id: string;
  name_ar: string;
  installment_count: number;
  interval_days: number;
  financing_percentage: number;
  fixed_fee_cents: number;
  down_payment_percentage: number;
  requires_saved_card: boolean;
  allowed_provider: string;
  document_requirements: { doc_type: string; label_ar: string }[];
}

// نسخة سياسة دفع مطبقة على checkout — النص من payment_policy_versions الحالية
export interface ApplicablePaymentPolicyDto {
  policyId: string;
  slug: string;
  titleAr: string;
  isRequired: boolean;
  currentVersionId: string;
  currentVersion: number;
  bodyAr: string;
}
