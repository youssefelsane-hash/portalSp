import { SetMetadata } from '@nestjs/common';

export const REQUIRE_STEP_UP_KEY = 'requireStepUp';

// نفس فلسفة @RequirePermission بالحرف — لأخطر العمليات بس (ADR-0011 §4): تغيير حساب صرف/اعتماد
// مبلغ كبير/إنشاء Super Admin/تغيير Roles/Permissions/إلغاء كل الجلسات/اعتماد Refund. لازم
// Passkey فعلي تاني حديث (دقيقتين)، مش إعادة استخدام جلسة الدخول العادية.
export const RequireStepUp = () => SetMetadata(REQUIRE_STEP_UP_KEY, true);
