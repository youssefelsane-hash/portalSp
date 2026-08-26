import { DEFAULT_COMMISSION_BASE_POLICY, CommissionBasePolicy } from './commission-base';
import { CommissionBaseService } from './commission-base.service';

/**
 * ستَب لسياسة وعاء العمولة (ADR-0037) للسبيكات اللي بتبني `OrdersService` بـpositional args
 * بدل حاوية الـDI. موجود كملف مشترك بدل 20+ نسخة مكررة في السبيكات.
 *
 * الافتراضي = نفس سياسة الإنتاج بالظبط، فالسبيك اللي مش مهتم بالعمولة بيفضل يختبر السلوك الحقيقي
 * مش سلوك مخترع. مرّر `overrides` بس لما تكون بتختبر سياسة مختلفة عن عمد.
 */
export function commissionBaseServiceStub(overrides: Partial<CommissionBasePolicy> = {}): CommissionBaseService {
  return {
    getPolicy: async () => ({ ...DEFAULT_COMMISSION_BASE_POLICY, ...overrides }),
  } as unknown as CommissionBaseService;
}
