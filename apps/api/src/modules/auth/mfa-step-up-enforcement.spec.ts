import { MFA_REQUIRED_PERMISSIONS } from './mfa-policy.service';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { REQUIRE_STEP_UP_KEY } from '../../common/decorators/require-step-up.decorator';
import { AdminOrdersController } from '../orders/admin-orders.controller';
import { AdminPaymentsController } from '../payments/admin-payments.controller';
import { AdminWalletController } from '../payments/admin-wallet.controller';
import { AdminRolesController } from '../admin/admin-roles.controller';
import { AdminUsersController } from '../admin/admin-users.controller';
import { AdminSettingsController } from '../admin/admin-settings.controller';
import { AdminBrandingController } from '../branding/admin-branding.controller';
import { AdminSupportController } from '../support/admin-support.controller';

// اختبار وحدة بسيط (صفر Postgres/DI — قراءة metadata الـdecorators مباشرة) — بَقّة أمنية حقيقية
// اتلقطت واتصلحت (تدقيق جاهزية الإطلاق النهائي، 2026-08-14): mfa-policy.service.ts's
// MFA_REQUIRED_PERMISSIONS بتوثّق نية واضحة ("أي عملية بالصلاحية دي لازم step-up") بس أربع
// endpoints (wallets.adjust, orders.adjust_price, payments.confirm_manual, settings.manage)
// كانت من غير @RequireStepUp() الفعلية خالص — StepUpGuard (مسجّل global) no-op تمامًا من غيرها،
// يعني جلسة مسروقة كانت تقدر تحوّل فلوس/تعدّل سعر/تأكد دفعة/تغيّر إعداد حساس من غير أي تأكيد
// Passkey حديث. الاختبار ده بيمنع نفس الفئة ترجع تحصل بصمت لأي endpoint جديد مستقبلي.
describe('كل endpoint بصلاحية من MFA_REQUIRED_PERMISSIONS لازم يكون عليه @RequireStepUp() فعليًا', () => {
  function stepUpMetadata(handler: (...args: unknown[]) => unknown): boolean | undefined {
    return Reflect.getMetadata(REQUIRE_STEP_UP_KEY, handler);
  }

  function permissionMetadata(handler: (...args: unknown[]) => unknown, controllerClass: object): string | undefined {
    return (
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, handler) ??
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controllerClass)
    );
  }

  // (controller, methodName, الصلاحية المتوقعة, هل لازم step-up) — كل endpoint حقيقي بيستخدم أي
  // صلاحية من MFA_REQUIRED_PERMISSIONS. rejectPayout مستثناة عمدًا: بترجّع حجز فلوس بالفعل موجود
  // (releaseReservation) لصاحبه الأصلي، مش تحويل فلوس لطرف تالت — نفس مستوى حساسية GET، مش نفس
  // مستوى approve/complete اللي فعلاً بيحركوا فلوس للخارج.
  const cases: [object, string, string, boolean][] = [
    [AdminPaymentsController.prototype, 'refundOrder', 'refunds.issue', true],
    [AdminPaymentsController.prototype, 'approvePayout', 'payouts.approve', true],
    [AdminPaymentsController.prototype, 'rejectPayout', 'payouts.approve', false],
    [AdminPaymentsController.prototype, 'completePayout', 'payouts.approve', true],
    [AdminPaymentsController.prototype, 'confirmInstaPayPayment', 'payments.confirm_manual', true],
    [AdminOrdersController.prototype, 'adjustPrice', 'orders.adjust_price', true],
    [AdminOrdersController.prototype, 'resolveFailedVisit', 'orders.resolve_failed_visit', true],
    [AdminOrdersController.prototype, 'resolveCashDispute', 'orders.resolve_cash_dispute', true],
    [AdminWalletController.prototype, 'adjustWallet', 'wallets.adjust', true],
    [AdminSettingsController.prototype, 'update', 'settings.manage', true],
    [AdminRolesController.prototype, 'createRole', 'roles.manage', true],
    [AdminRolesController.prototype, 'updateRole', 'roles.manage', true],
    [AdminRolesController.prototype, 'cloneRole', 'roles.manage', true],
    [AdminRolesController.prototype, 'deleteRole', 'roles.manage', true],
    [AdminRolesController.prototype, 'setRolePermissions', 'roles.manage', true],
    [AdminUsersController.prototype, 'assignRole', 'roles.manage', true],
    [AdminBrandingController.prototype, 'upload', 'branding.manage', true],
    [AdminBrandingController.prototype, 'remove', 'branding.manage', true],
    // Script 7 Phase 24 — complaints.resolve بتحوّل compensation_cents فلوس حقيقية بلا حد أقصى،
    // كانت ناقصة من القايمة والـdecorator الاتنين (راجع BUG-012 في docs/21).
    [AdminSupportController.prototype, 'resolve', 'complaints.resolve', true],
  ];

  it.each(cases)('%s.%s (صلاحية %s) — step-up مطلوب: %s', (controllerProto, methodName, expectedPermission, requiresStepUp) => {
    const proto = controllerProto as Record<string, (...args: unknown[]) => unknown>;
    const handler = proto[methodName];
    expect(handler).toBeDefined();

    const actualPermission = permissionMetadata(handler, controllerProto.constructor);
    expect(actualPermission).toBe(expectedPermission);
    expect(MFA_REQUIRED_PERMISSIONS as readonly string[]).toContain(expectedPermission);

    expect(!!stepUpMetadata(handler)).toBe(requiresStepUp);
  });
});
