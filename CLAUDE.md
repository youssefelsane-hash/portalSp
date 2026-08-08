# baytak — سياق سريع لأي سيشن جديدة

اقرأ الملف ده الأول قبل أي حاجة. لو عايز التفاصيل الكاملة: `docs/01-master-plan.md` (الخطة) و`docs/02-data-dictionary.md` (قاموس البيانات + عقد الـ API). القاعدة الحاكمة: أي تغيير في اسم جدول/عمود بعد اعتماد `02-data-dictionary.md` لازم migration موثّق.

## إيه اللي موجود فعلاً دلوقتي (مش خطة — كود شغال ومختبر)

**`apps/api`** (NestJS + PostgreSQL/PostGIS + Redis + BullMQ) — **~15,000 سطر، 20 موديول، 32 migration، شغال ومختبر حي على Postgres/Redis حقيقيين.** كل الـ12 نقطة اللي كانت مطلوبة (RBAC هرمي، إدارة الموظفين، إدارة الفنيين، مستويات الفنيين، الفرق/الشركات، الكتالوج الديناميكي، المناطق/الفروع، لوحة تحكم موسّعة، audit log، الإشعارات، محرك الإعدادات، البنية event-driven بالـ queues/caching) لها كود شغال. الأمر: `cd apps/api && npm run start:dev` (يحتاج Postgres+Redis شغالين، راجع `infra/docker/docker-compose.yml`).

**`apps/admin`** (Next.js 16 + shadcn/ui) — شاشات أساسية شغالة ومختبرة (Playwright ضد الباك-إند الحقيقي): موظفين، فنيين، طلبات، كتالوج، إعدادات، سجل نشاط، عارض صور الطلب. تفاصيل كاملة في `apps/admin/README.md`.

**`apps/customer-app`, `apps/technician-app`** (Flutter) — **كود شغال حقيقي، مش README فاضي** — auth بالـ OTP، طلبات (إنشاء/تنفيذ/إلغاء بسبب+رسوم/تقييم)، دفع من المحفظة، شات وتتبع لحظي (Socket.IO)، رفع صور، أرباح/صرف للفني. **Flutter SDK متاح فعلاً في البيئة دي على `/opt/flutter/bin` — مش في `PATH` افتراضياً، لازم `export PATH="$PATH:/opt/flutter/bin"` الأول.** اختبارات حية حقيقية في `test_live/` لكل التطبيقين (`flutter test test_live/ --dart-define=API_BASE_URL=http://localhost:3000/api/v1`) — تفاصيل كاملة في الـ READMEs بتاعتهم. الجزء اللي لسه مش قابل للاختبار هنا تحديداً: رندر الـ widgets الفعلي وتفاعل اللمس (مفيش emulator/device حقيقي، ومحاولة Linux desktop فشلت — تفاصيل في `apps/customer-app/README.md`).

**`packages/shared-types`** — أنواع TypeScript مشتركة بين `apps/api` و`apps/admin`، محتاج `npm run build` يدوي بعد أي تعديل (مفيش watch mode).

## فجوات موثّقة صراحة (مش سهو — دوّر عليها بـ `grep -rn "فجوة موثّقة" apps/api/src --include="*.md"`)

أهمها: بَقّة BullMQ Worker reconnection بعد انقطاع Redis طويل (موثّقة بالتفصيل في `apps/api/src/modules/technicians/README.md` — مطابقة لـ GitHub issue #4479 في BullMQ نفسه، مش حاجة تتصلح من كودنا). باقي الفجوات أصغر (endpoints ناقصة، خوارزميات يدوية مؤقتاً).

## اتفاقيات ثابتة (من `docs/01-master-plan.md` §1.3)

- أسماء الجداول/الأعمدة: `snake_case`. الكود: `camelCase`. الـ API routes: `kebab-case`.
- كل الأسعار بالقرش (`integer`, مش `float`). كل الأوقات UTC. كل جدول فيه `id, created_at, updated_at, deleted_at`.
- Migrations: SQL خام في `infra/migrations/`، `synchronize:false` دايماً، ما تعدّلش migration اتعمل commit — دايماً ملف جديد برقم تالي.
- كود التعليقات: عربي، وبس لما السبب مش واضح من الاسم نفسه (مش شرح "بيعمل ايه").

## طريقة العمل المتّبعة في السيشنز اللي فاتت (اتّبعها)

1. مفيش توقف للتأكيد بين المهام — اختار المهمة الجاية، ابنيها، اختبرها حي (مش mocks) على Postgres/Redis حقيقيين شغالين فعلاً، لو لقيت بَقّة حقيقية اتعامل معاها، وثّق بصراحة (حتى الفجوات والقصور)، commit + push، كمّل.
2. أي فشل في cache/queue/infra لازم يتلقّط ويتعامل معاه بأمان (يرجع null/يسجّل تحذير/يرجع للـ DB) — أبداً ميكسرش أو يعلّق العملية الحقيقية للمستخدم. الدرس المكلف من السيشن ده: `queue.add()` كانت بتعلّق طلب حقيقي (تقييم/دفع) لدقايق وقت انقطاع Redis قبل ما نكتشف ونصلح.
3. قبل أي commit: `npx tsc --noEmit` ثم `npx nest build` ثم `npx jest` في `apps/api` — الثلاثة لازم يعدّوا نضيف.
4. كل موديول له `README.md` بيوثّق القرارات والفجوات بصراحة — حدّثه لما تلمس الموديول.

## فريق العمل الحالي

فرع Git: `claude/home-services-app-plan-v13gb2`. لا تعمل push على فرع تاني من غير إذن صريح.
