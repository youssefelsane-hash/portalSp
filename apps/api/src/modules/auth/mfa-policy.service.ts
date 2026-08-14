import { Injectable } from '@nestjs/common';
import { PermissionsService } from '../admin/permissions.service';

// تعريف "High-Privilege" ديناميكي بالصلاحية مش بالاسم (ADR-0011، قرار عمل صريح من المالك
// 2026-08-13: "أي حساب يقدر يشوف/يتحكم في الفلوس أو يغير Roles/Permissions لازم MFA إجباري").
// بما إن الـRBAC كامل ديناميكي (ADR-0010)، القايمة دي **مش** بديل عن فحص حي — هي المجموعة اللي
// بيتفحص وجودها حية عند كل دخول، فدور جديد يتمنح أي صلاحية منها بعدين بيبقى ملزَم فورًا من غير
// أي تعديل كود هنا.
export const MFA_REQUIRED_PERMISSIONS = [
  'refunds.issue',
  'payouts.approve',
  'orders.adjust_price',
  'roles.manage',
  'roles.grant_unrestricted',
  'settings.manage',
  // تأكيد استلام دفعة InstaPay يدويًا (ADR-0013 §7) — تحكم مباشر في فلوس حقيقية (بيسوّي الدفعة
  // SUCCEEDED ويبدأ التوزيع)، نفس مبدأ refunds.issue/payouts.approve فوق بالحرف.
  'payments.confirm_manual',
] as const;

@Injectable()
export class MfaPolicyService {
  constructor(private readonly permissionsService: PermissionsService) {}

  /** super_admin بيتخطى الـpermission join بالكامل (ADR-0010) — getUserPermissionNames() بترجّع له كل الكتالوج، فالفحص العادي كافي وبيغطيه تلقائيًا. */
  async userRequiresMfa(userId: string): Promise<boolean> {
    const permissions = await this.permissionsService.getUserPermissionNames(userId);
    return MFA_REQUIRED_PERMISSIONS.some((p) => permissions.has(p));
  }
}
