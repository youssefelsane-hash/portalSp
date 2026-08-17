# Script 2 — Security, Realtime, Durable Events, Storage & Release Hardening

هذا الملف سجل checkpoints للـScript 2 فقط. الأساس هو Script 1 SHA `6ebbe88`، والعمل على
`codex/script-2-security-release-hardening` دون تعديل `main` أو فرع Script 1.

## Phase A — Authentication, session, and account integrity

**Status: verified locally and against real PostgreSQL.**

Invariant المنفذ:

- OTP challenge واحد ينجح مرة واحدة فقط، والأحدث وحده يظل صالحًا بعد resend.
- محاولات التخمين تُحسب ذريًا ولا تضيع بسبب rollback لاستثناء التحقق.
- نجاح التسجيل يعني وجود User + profile المناسب + wallet + refresh session معًا، أو لا شيء.
- كل مدخلات الهاتف في auth تُوحّد إلى E.164، والحساب غير النشط/المحظور لا يحصل على جلسة جديدة.

الإثبات:

- `auth.service.spec.ts`: 5/5.
- `phone-normalization.spec.ts`: 4/4.
- `otp-registration-integrity.spec.ts`: 9/9 على PostgreSQL حقيقي مع `--detectOpenHandles`.
- `npx tsc --noEmit`: pass.
- migration `0122_auth_otp_integrity.sql` طُبقت على TEST؛ checksums من `0001` إلى `0122` مطابقة.

## Phase B — Realtime/WebSocket security

**Status: verified locally and against real PostgreSQL + Socket.IO.**

- `RealtimeAccessService` يطابق فحص REST الحي عند الاتصال وقبل كل event حساس.
- `RealtimeSessionRegistry` يستمع لـPostgreSQL `NOTIFY`؛ migration `0123` تنشر بعد commit لتغييرات
  الحظر/التفعيل/عضوية الدور/صلاحياته. اختبار باثنين registry مستقلين أثبت فصل كل instances.
- chat join/send وtracking join/location لديهم DTOs صارمة وownership/state revalidation. تحديث الموقع
  محدود إلى 10/10s ويرفض type coercion وNaN/Infinity وخارج النطاق والحقول الزائدة.
- status events المتأخرة تُسقط بمقارنة الحالة الحالية، وتطبيقات Flutter تعيد REST load بدل تطبيق
  event كحقيقة. chat screens تعمل dedupe بالمعرف، وjoin يعيد snapshot state للـreconnect.
- internal-chat يستبعد blocked/inactive من contacts ومنع thread جديد أو رسالة جديدة، مع إبقاء
  الخيط التاريخي ظاهرًا. تعطيل الموظف يزامن profile/User ويسحب الجلسات ذريًا.

الإثبات: 8 suites / 36 tests في مصفوفة Phase B، منها Socket.IO حقيقي وPostgreSQL متعدد listeners،
ثم full Nest bootstrap نجح وسجل `RealtimeSecurityModule` والـgateways، وتوقف نظيفًا بـSIGINT.

## Remaining phases

Durable outbox and workers, notifications/support concurrency, storage, pricing/provider/config/web
release hardening, security matrix, and performance gates remain in progress.
