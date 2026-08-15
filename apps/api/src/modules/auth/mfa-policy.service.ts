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
  // تغيير البراندنج المعروض لكل المستخدمين في كل التطبيقات (ADR-0014) — تحكم مباشر في هوية
  // المنصة العامة، نفس مستوى حساسية settings.manage فوق.
  'branding.manage',
  // تصحيح محفظة يدوي (docs/08 §20 بند 5، migration 0104) — تحويل فلوس مباشر بقرار أدمن بلا أي
  // نظام تلقائي يتحقق منه، نفس مستوى حساسية refunds.issue/payouts.approve بالظبط.
  'wallets.adjust',
  // حل زيارة فاشلة/عدم حضور (docs/08 §22 بند 4-5، migration 0107) — رسوم + استرداد بقرار أدمن،
  // نفس مستوى حساسية orders.adjust_price بالظبط.
  'orders.resolve_failed_visit',
  // حل نزاع تسليم كاش (docs/08 §22 بند 13-14، migration 0108) — تسوية مالية محتملة بقرار أدمن،
  // نفس مستوى حساسية orders.resolve_failed_visit بالظبط.
  'orders.resolve_cash_dispute',
  // موافقة أرباح عمالة منزلية (docs/08 §25.1، migration 0112) — تحويل فلوس مباشر من محفظة
  // المنصة لمحفظة الشغالة بقرار أدمن، نفس مستوى حساسية payouts.approve/wallets.adjust بالظبط.
  'domestic_workers.approve_earnings',
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
