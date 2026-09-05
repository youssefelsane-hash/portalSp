import { SetMetadata } from '@nestjs/common';

export const ANY_ADMIN_KEY = 'anyAdminReason';

/**
 * إعلان صريح إن الـendpoint ده متاح لأي موظف أدمن **من غير** صلاحية دقيقة.
 *
 * `PermissionsGuard` بطبعه fail-open: مسار من غير `@RequirePermission` بيعدّي لأي أدمن. ده كان
 * معناه إن مسار جديد بيتكتب من غير ديكوريتور = مفتوح للكل بالصدفة، ومحدش بيلاحظ (تدقيق S-1:
 * ٩٢ مسار أدمن كانوا كده). `AdminRouteRbacValidator` بيمنع ده دلوقتي: التطبيق مابيقومش لو مسار
 * مقصور على الأدمن مالوش `@RequirePermission` ولا `@AnyAdmin`.
 *
 * الديكوريتور ده مش «إعفاء» — هو **القرار المكتوب**: الـ`reason` بيتخزّن في الميتاداتا وبيتطبع
 * في تقرير التحقق، فأي حد بيراجع بعد كده يشوف ليه المسار ده مفتوح بدل ما يخمّن.
 *
 * استخدمه بس لما الـendpoint بيقرا/يكتب حاجة تخص **الموظف نفسه** (صلاحياته هو، نبضة حضوره هو).
 */
export const AnyAdmin = (reason: string) => SetMetadata(ANY_ADMIN_KEY, reason);
