// **تفاوت الحماية في سلسلة إنشاء الموظف** (ADR-0111 §3).
//
// التفاوت كان مقلوب: `roles.manage` (منح الصلاحيات للحساب الجديد) كانت مطالبة بـMFA وstep-up،
// بينما **إنشاء الحساب الإداري نفسه** (`employees.manage`) وفتح حساب مقفول (`users.reset_pin`)
// مكانوش. يعني آخر خطوة في السلسلة محميّة وأولها لأ.
import { readFileSync } from 'fs';
import { join } from 'path';
import { MFA_REQUIRED_PERMISSIONS } from '../auth/mfa-policy.service';

describe('تحصين إنشاء الموظف (ADR-0111)', () => {
  const controller = readFileSync(join(__dirname, 'admin-employees.controller.ts'), 'utf8');

  it('`POST /admin/employees` عليه step-up — بيعمل حساب user_type=admin', () => {
    // النداء بيوسّع دايرة الموظفين، فمش أقل خطورة من **استرجاع** رمز حساب موجود اللي كان
    // بيطلب step-up أصلاً.
    const createBlock = controller.slice(controller.indexOf('@Post()'), controller.indexOf('create('));
    expect(createBlock).toContain('@RequireStepUp()');
    expect(createBlock).toContain("@RequirePermission('employees.manage')");
  });

  it('`POST :userId/activation-code` عليه نفس الحماية بالظبط', () => {
    const block = controller.slice(
      controller.indexOf("@Post(':userId/activation-code')"),
      controller.indexOf('reissueActivationCode('),
    );
    expect(block).toContain('@RequireStepUp()');
    expect(block).toContain("@RequirePermission('employees.manage')");
  });

  it('`employees.manage` و`users.reset_pin` بقوا high-privilege (MFA إجباري)', () => {
    expect(MFA_REQUIRED_PERMISSIONS).toContain('employees.manage');
    expect(MFA_REQUIRED_PERMISSIONS).toContain('users.reset_pin');
    // لسه موجودة — مش استبدال
    expect(MFA_REQUIRED_PERMISSIONS).toContain('roles.manage');
  });

  it('إنشاء الموظف بيصدر كود التنشيط **جوّه نفس المعاملة**', () => {
    // لو الكود اتصدر في نداء تاني، موظف كان يقدر يوجد بلا مدخل — وده الطريق المسدود بعينه.
    const service = readFileSync(join(__dirname, 'admin-employees.service.ts'), 'utf8');
    const txn = service.slice(service.indexOf('await this.dataSource.transaction'), service.indexOf('return { user, profile, activation };'));
    expect(txn).toContain('issuePinSetupCode');
  });

  it('السجل بيوثّق إن تصريح اتصدر — **من غير الكود نفسه**', () => {
    const service = readFileSync(join(__dirname, 'admin-employees.service.ts'), 'utf8');
    expect(service).toContain('activation_code_expires_at: activation.expiresAt.toISOString()');

    // **الفحص على كتل السجل نفسها بس.** النسخة الأولى من التأكيد ده كانت `newValues:` + ٤٠٠ حرف،
    // فكانت بتمتد لبرّه السجل وتلاقي `activation_code: activation.code` في **جملة الـreturn** —
    // وهي المكان الصح للكود (بيرجع للأدمن مرة واحدة). التأكيد كان بيفشل على كود سليم.
    const auditBlocks = [...service.matchAll(/await this\.auditLog\.record\(\{([\s\S]*?)\n {4}\}\);/g)].map(
      (m) => m[1],
    );
    expect(auditBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of auditBlocks) {
      expect(block).not.toContain('activation.code');
    }
  });
});
