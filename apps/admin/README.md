# apps/admin — لوحة الإدارة

لوحة تحكم العمليات: العملاء، الفنيين، الطلبات، الأرباح، الشكاوى، الإحصائيات. الستاك: **Next.js 16 (App Router) + shadcn/ui (radix base) + Tailwind v4**، RTL بالكامل (`lang="ar" dir="rtl"`).

## الحالة الحالية — بداية حقيقية شغالة، مش كل الشاشات لسه

اللي موجود ومختبر حي (مش mocks) على الباك-إند الحقيقي:
- تسجيل دخول OTP كامل (طلب كود → تحقق → جلسة) ضد `apps/api` الحقيقي.
- صفحة نظرة عامة (`/`) بتعرض `DashboardStats` حقيقية من `/admin/dashboard/stats`.
- حماية المسارات عبر `proxy.ts` (اسم middleware الجديد في Next.js 16 — راجع "ملاحظات Next.js 16" تحت).
- تسجيل خروج.

**لسه من غير**: شاشات CRUD الفعلية (الموظفين، الفنيين، الطلبات، الكتالوج، الإعدادات، سجل الـ audit) — دي المرحلة الجاية.

## المعمارية الأمنية للـ auth (مهم قبل ما تلمس أي حاجة هنا)

- **`refresh_token`**: httpOnly cookie، مايوصلش لجافاسكريبت العميل خالص — بيتحط عن طريق Route Handlers فقط (`src/app/api/auth/*`)، دي طبقة BFF (backend-for-frontend) بسيطة بتبروكسي لـ `apps/api`.
- **`access_token`**: قصير العمر (15 دقيقة)، في الذاكرة بس (React state، مش localStorage) — عشان يبقى أقل عرضة لسرقة عبر XSS.
- **باقي نداءات الـ API الحقيقية** (dashboard stats وغيرها) بتتبعت مباشرة لـ `apps/api` من الـ client (`NEXT_PUBLIC_API_URL`)، برفقة `Authorization: Bearer` — مش عن طريق البروكسي، عشان مانكتبش proxy route لكل endpoint.

### بَقّة حقيقية اتلقطت واتصلحت وقت البناء — Single-flight refresh

الباك-إند بيدوّر `refresh_token` على كل استخدام، وأي إعادة استخدام لتوكن اتلغى بيتعامل معاه كسرقة محتملة فبيقفل **كل** جلسات المستخدم فوراً (`revokeAllUserTokens` في `apps/api/.../auth.service.ts`). React Strict Mode (شغال افتراضياً في التطوير) بيعيد تشغيل الـ `useEffect` بتاع فحص الجلسة عند التحميل **مرتين** — لو كل تشغيلة بعتت نداء `/api/auth/refresh` منفصل، التاني كان هيستخدم نفس الكوكي القديم اللي التاني لسه ما دوّرهوش، فيترفض ويقفل حساب الأدمن كله. اتصلح بـ `inFlightRefresh` ref في `src/lib/auth-context.tsx` — أي نداء refresh بيشارك نفس الـ promise "في الطيران" بدل ما يبعت نداء منفصل، فمفيش سباق. اتأكد الإصلاح حياً (login → reload → session لسه شغالة → logout → redirect صحيح).

**فجوة موثّقة متبقية**: الحل ده بيمنع السباق **جوّه نفس تحميل الصفحة**. لسه مفيش حماية من سباق عبر تابين مفتوحين لنفس الحساب في نفس اللحظة (كل تاب عنده React state منفصل) — سيناريو نادر بس ممكن، والحل الكامل محتاج إما تنسيق بين التابات (`BroadcastChannel`) أو "فترة سماح" في الباك-إند لإعادة استخدام نفس الـ refresh token خلال ثواني قليلة (نمط شائع في أنظمة rotating refresh tokens).

## ملاحظات Next.js 16 (breaking changes حقيقية اتلقطت)

- **`middleware.ts` بقى `proxy.ts`، والدالة اسمها `proxy` مش `middleware`** — الاسم القديم deprecated. اتعمل التحويل هنا باستخدام الـ codemod الرسمي (`npx @next/codemod@canary middleware-to-proxy .`)، مش تخمين.
- `useSearchParams()` محتاج `<Suspense>` boundary عشان الـ static prerendering ينجح في `next build` — لاحظناها لما الـ build فشل على `/login`.

## shadcn/ui بدون شبكة

`ui.shadcn.com` محجوب بسياسة الشبكة في بيئة التطوير اللي اتبنى فيها المشروع ده (403 على CONNECT). المكوّنات في `src/components/ui/` اتكتبت يدوياً (مطابقة لمصدر shadcn المعروف: `button`, `input`, `label`, `card`) بدل ما نعتمد على `shadcn init`/`shadcn add` اللي بيكلموا الشبكة دي. لو الشبكة اتفتحت مستقبلاً، تقدر تستخدم `npx shadcn@latest add <component>` عادي — بس تأكد إنه مش هيكتب فوق الملفات دي بتنسيق مختلف.

## التشغيل محلياً

```bash
# من جذر المستودع (npm workspaces) — لازم apps/api شغال على :3000 (Postgres+Redis شغالين)
npm install
cd apps/admin
cp .env.example .env.local   # لو مش موجود
npm run dev                  # بيشتغل على :3001 (مش :3000 عشان apps/api واخده)
```

`@baytak/shared-types` (`packages/shared-types`) لازم يتبني (`npm run build` هناك) بعد أي تعديل فيه قبل ما `apps/admin` يشوف الأنواع الجديدة — مفيش watch mode تلقائي دلوقتي (فجوة صغيرة، محتاجة إما TypeScript project references أو سكريبت watch لما نلاحظ الاحتكاك ده بيبطّئنا فعلاً).

مرجع كامل: `../../docs/01-master-plan.md`
