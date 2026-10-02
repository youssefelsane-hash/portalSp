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

  /*
    ═══ المسح الشامل (docs/08 §188) ═══

    القايمة فوق **مكتوبة بالإيد**، وده بالظبط اللي خلّى `AdminTechnicianDebtController.
    recordSettlement` (`wallets.adjust` — بيحرّك فلوس حقيقية) يعدّي من غير step-up: محدش ضافه
    للقايمة. التعليق جوّه الكونترولر كان بيقول «نفس حماية التصحيح اليدوي» والـdecorator مش موجود.

    المسح ده بيقرا **كل** كونترولر في المشروع، وأي مسار بيكتب (POST/PUT/PATCH/DELETE) بصلاحية من
    `MFA_REQUIRED_PERMISSIONS` لازم يبقى عليه `@RequireStepUp()` — إلا المستثنى هنا بسبب مكتوب.
    كونترولر جديد بكرة بيدخل المسح أوتوماتيك من غير ما حد يفتكر يضيفه.
  */
  it('مسح شامل: كل مسار كتابة بصلاحية MFA عليه step-up فعلاً (إلا المستثنى بسبب مكتوب)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PATH_METADATA, METHOD_METADATA } = require('@nestjs/common/constants');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RequestMethod } = require('@nestjs/common');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');

    /** `Controller.method` ← السبب. أي استثناء جديد لازم سببه يتكتب هنا صراحةً. */
    const EXEMPT: Record<string, string> = {
      // بترجّع حجز فلوس موجود لصاحبه الأصلي (releaseReservation)، مش تحويل لطرف تالت.
      'AdminPaymentsController.rejectPayout': 'بترجّع مبلغ محجوز لصاحبه — مفيش فلوس خارجة',
      // بيستعملوا صلاحية السعر كـ**بوابة وصول** لطابور المعاينة، مش بيغيّروا سعر: رفع صورة
      // للمشكلة، وطلب معلومات إضافية من العميل. الـPasskey على كل صورة كان هيبقى احتكاك بلا حماية.
      'AdminOrdersController.uploadProblemImage': 'رفع صورة مشكلة — مفيش سعر بيتغيّر',
      'AdminOrdersController.requestAssessmentInfo': 'طلب معلومات من العميل — مفيش سعر بيتغيّر',
      // الفلوس في الشكوى بتتحرّك في `resolve` بس (التعويض) وده محمي. الرفض والإقفال وتغيير
      // الخطورة قرارات تشغيلية مابتحرّكش قرش.
      'AdminSupportController.reject': 'رفض شكوى — مفيش تعويض بيتصرف',
      'AdminSupportController.close': 'إقفال شكوى — مفيش تعويض بيتصرف',
      'AdminSupportController.updateSeverity': 'تصنيف خطورة — مفيش فلوس',
      // الحكم على إشارة وفتح حالة قرارات مراجعة مسجّلة، مابتعلّقش حساب ولا بتحرّك فلوس. اللي بيلمس
      // الحساب فعلاً (`action`) والتشغيل اليدوي للكواشف عليهم step-up.
      'AdminRiskCenterController.verdict': 'حكم على إشارة — مفيش إجراء على الحساب',
      'AdminRiskCenterController.upsertCase': 'فتح/تحديث حالة مراجعة — مفيش إجراء على الحساب',
    };

    const writeVerbs = new Set([RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE]);
    const mfaPermissions = new Set<string>(MFA_REQUIRED_PERMISSIONS);

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.controller.ts')) files.push(full);
      }
    };
    walk(path.join(__dirname, '..', '..'));

    const missing: string[] = [];
    let scannedRoutes = 0;
    for (const file of files) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const exported = require(file) as Record<string, unknown>;
      for (const candidate of Object.values(exported)) {
        if (typeof candidate !== 'function' || Reflect.getMetadata(PATH_METADATA, candidate) === undefined) continue;
        const proto = candidate.prototype as Record<string, (...args: unknown[]) => unknown>;
        for (const methodName of Object.getOwnPropertyNames(proto)) {
          if (methodName === 'constructor') continue;
          const handler = proto[methodName];
          if (typeof handler !== 'function') continue;
          const verb = Reflect.getMetadata(METHOD_METADATA, handler);
          if (verb === undefined || !writeVerbs.has(verb)) continue;
          const permission = permissionMetadata(handler, candidate);
          if (!permission || !mfaPermissions.has(permission)) continue;
          scannedRoutes += 1;
          const id = `${candidate.name}.${methodName}`;
          if (!stepUpMetadata(handler) && !EXEMPT[id]) missing.push(`${id} (${permission})`);
        }
      }
    }

    // لو المسح مالقاش ولا مسار، يبقى هو اللي بايظ مش المشروع اللي سليم.
    expect(scannedRoutes).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });

  /*
    ═══ المسح العكسي ═══

    الـPasskey بيتسجّل بس وقت دخول حساب صلاحياته من `MFA_REQUIRED_PERMISSIONS`. فمسار عليه
    `@RequireStepUp()` وصلاحيته برّه القايمة بيبقى **مقفول للأبد** على أي دور ماعندوش صلاحية تانية
    منها: الموظف مايقدرش يسجّل Passkey، فمايقدرش يعدّي الـstep-up. ده اللي حصل لـ
    `risk_center.manage` و`installments.review`.
  */
  it('مسح عكسي: كل مسار عليه step-up صلاحيته من قايمة MFA (إلا المسارات الذاتية)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PATH_METADATA } = require('@nestjs/common/constants');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');

    /** مسارات المستخدم على حسابه هو (مالهاش صلاحية إدارية) — `Controller.method` ← السبب. */
    const SELF_SERVICE: Record<string, string> = {
      'SessionsController.revokeAll': 'المستخدم بيقفل جلساته هو',
      'WebAuthnController.removeCredential': 'المستخدم بيمسح Passkey بتاعه',
    };

    const mfaPermissions = new Set<string>(MFA_REQUIRED_PERMISSIONS);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.controller.ts')) files.push(full);
      }
    };
    walk(path.join(__dirname, '..', '..'));

    const unreachable: string[] = [];
    let stepUpRoutes = 0;
    for (const file of files) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const exported = require(file) as Record<string, unknown>;
      for (const candidate of Object.values(exported)) {
        if (typeof candidate !== 'function' || Reflect.getMetadata(PATH_METADATA, candidate) === undefined) continue;
        const proto = candidate.prototype as Record<string, (...args: unknown[]) => unknown>;
        for (const methodName of Object.getOwnPropertyNames(proto)) {
          if (methodName === 'constructor') continue;
          const handler = proto[methodName];
          if (typeof handler !== 'function' || !stepUpMetadata(handler)) continue;
          stepUpRoutes += 1;
          const id = `${candidate.name}.${methodName}`;
          const permission = permissionMetadata(handler, candidate);
          if (!permission) {
            if (!SELF_SERVICE[id]) unreachable.push(`${id} (بلا صلاحية)`);
          } else if (!mfaPermissions.has(permission)) {
            unreachable.push(`${id} (${permission})`);
          }
        }
      }
    }

    expect(stepUpRoutes).toBeGreaterThan(20);
    expect(unreachable).toEqual([]);
  });
});
