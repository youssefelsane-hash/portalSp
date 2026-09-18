
/**
 * نظرة الأدمن على «رشّح صحابك» لعميل واحد (docs/08 §165).
 *
 * `GET /admin/referrals/customers/:userId` — قراءة بحتة. البرنامج كان شغّال من غير أي مسار
 * أدمن، فالموظف مكانش قادر يراجع شكوى عن مكافأة ناقصة.
 */
export interface AdminReferralOverview {
  referral_code: string | null;
  completed_count: number;
  pending_count: number;
  required_per_reward: number;
  referred: {
    user_id: string;
    full_name: string | null;
    phone_number: string | null;
    status: string;
    completed_at: string | null;
    reference_order_number: string | null;
    joined_at: string;
  }[];
}
