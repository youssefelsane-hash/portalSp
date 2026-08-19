# Script 7 — تدقيق جاهزية الإنتاج الكامل (Full Production Readiness Audit)

بدأ: 2026-08-19. فرع Git: `claude/home-services-app-plan-v13gb2`.

هذا الملف هو نقطة التتبع الحية الإلزامية لكل الـ35 مرحلة المطلوبة في الـaudit ده. **لازم يتحدّث
بعد كل مرحلة تخلص** — لو السيشن اتقطعت أو الـcontext اتضغط، الملف ده هو مصدر الحقيقة اللي بيمنع
ضياع أي نطاق. كل مرحلة لازم يكون ليها **حالة واحدة بالظبط** من: `VERIFIED` / `FIXED` / `PARTIAL` /
`NOT APPLICABLE` / `BLOCKED BY EXTERNAL DEPENDENCY` / `NEEDS BUSINESS DECISION` / `PENDING`
(مؤقتة لحد ما تتفحص).

## طريقة العمل لكل مرحلة (إلزامية، من تعليمات المالك بالحرف)

1. اكتب الـinvariants الدقيقة اللي بتتفحص.
2. حدّد كل code paths اللي ممكن تغيّر الحالة دي.
3. اختبر حالة نجاح حقيقية واحدة على الأقل.
4. اختبر أخطر الحالات السلبية.
5. افحص حالة الداتابيز المحفوظة فعليًا.
6. تأكد من كل الواجهات المتأثرة (عميل/أدمن/فني).
7. أصلح أي بَقّة حقيقية اتأكدت.
8. ضيف regression test كان هيفشل قبل الإصلاح.
9. شغّل الـregression الخاص بالموديول.
10. اعمل commit للمرحلة قبل ما تكمّل اللي بعدها.

---

## جدول تغطية المراحل (إلزامي — 35 صف بالظبط)

| # | Phase | Area | Status | Live Tested? | Regression Test? | Bugs Found | Bugs Fixed | Remaining Risk | Evidence / Commit |
|---|-------|------|--------|---------------|-------------------|------------|------------|-----------------|--------------------|
| 0 | tokenHash fix (carried over) | Security — employee sessions endpoint | VERIFIED | نعم — HTTP حي كامل (login حقيقي OTP، 200 مع فحص المفاتيح+القيم، 401 بلا توكن، 403 بلا صلاحية) | نعم — `employee-session-response.spec.ts` (3 اختبارات) | BUG-002 (test hygiene، s22c) | BUG-002 fixed | لا يوجد — الفحص مزدوج (allowlist مفاتيح + بحث عن القيم الحساسة الفعلية في الرد المُسلسَل) | commit قادم — انظر BUG-001/002 تحت |
| 1 | Customer Auth & Account | Auth | PENDING | | | | | | |
| 2 | Service Discovery | Catalog | PENDING | | | | | | |
| 3 | Booking Configuration (pricing fields) | Pricing | PENDING | | | | | | |
| 4 | Pricing Engine | Pricing | PENDING | | | | | | |
| 5 | Productivity / Crew Calculation | Catalog/Productivity | PENDING | | | | | | |
| 6 | Address / GPS / Serviceability | Addresses/Geo | PENDING | | | | | | |
| 7 | Booking Modes (ASAP/Scheduled) | Orders | PENDING | | | | | | |
| 8 | Provider Selection UX & Semantics | Technicians/Matching | PENDING | | | | | | |
| 9 | Order Creation (idempotency) | Orders | PENDING | | | | | | |
| 10 | Cash Payment | Payments/Orders | PENDING | | | | | | |
| 11 | Online Payment | Payments | PENDING | | | | | | |
| 12 | Dispatch & Matching | Matching | PENDING | | | | | | |
| 13 | Capacity / Multi-worker Jobs | Matching/Crew | PENDING | | | | | | |
| 14 | Technician App | Technician-app | PENDING | | | | | | |
| 15 | Order State Machine | Orders | PENDING | | | | | | |
| 16 | Cancellations | Orders | PENDING | | | | | | |
| 17 | Refunds | Payments | PENDING | | | | | | |
| 18 | Wallet / Ledger / Commission | Wallets | PENDING | | | | | | |
| 19 | Provider Payouts | Payouts | PENDING | | | | | | |
| 20 | Promo / Referral / Discounts | Promotions | PENDING | | | | | | |
| 21 | Completion | Orders | PENDING | | | | | | |
| 22 | Ratings & Reviews | Ratings | PENDING | | | | | | |
| 23 | Warranty / Revisit | Orders/Warranty | PENDING | | | | | | |
| 24 | Complaints / Support | Support | PENDING | | | | | | |
| 25 | Admin Control Plane | Admin | PENDING | | | | | | |
| 26 | Admin RBAC | Admin/Security | PENDING | | | | | | |
| 27 | Security Center | Admin/Security | PENDING | | | | | | |
| 28 | Audit Logging | Audit | PENDING | | | | | | |
| 29 | Notifications | Notifications | PENDING | | | | | | |
| 30 | Concurrency & Idempotency | Cross-cutting | PENDING | | | | | | |
| 31 | Database Invariants | Cross-cutting | PENDING | | | | | | |
| 32 | UI/UX Quality | Customer-app | PENDING | | | | | | |
| 33 | Error Handling / Observability | Cross-cutting | PENDING | | | | | | |
| 34 | Full Golden-Path Live Test | Cross-cutting | PENDING | | | | | | |
| 35 | Financial Reconciliation Test | Wallets/Payments | PENDING | | | | | | |

---

## سجل البَقّات (Bug Register)

نموذج كل بَقّة:

```
BUG-XXX
Severity: P0/P1/P2/P3
Flow:
Symptom:
Reproduction:
Expected:
Actual:
Root cause:
Files involved:
Financial/security impact:
Fix:
Regression test:
Live verification:
Status: FIXED / OPEN / NEEDS BUSINESS DECISION
```

### BUG-001 — (رصيد فارغ، احتياطي للترقيم — أول بَقّة فعلية اتسجلت هي BUG-002 لأن الفحص الأول كان تأكيد سلبي/إيجابي مش بَقّة)

### BUG-002
Severity: P2 (test hygiene / DB pollution — مش أمان/مالي مباشر، لكن بيكسر موثوقية الـregression وبيسرّب صفوف يتيمة دائمة في قاعدة التطوير)
Flow: Phase 0 (regression أثناء التحقق من إصلاح tokenHash) → orders module concurrency tests
Symptom: `s22-cross-operation-concurrency.spec.ts` بيفشل بـ"Test suite failed to run" (مش فشل اختبار فردي) في كل مرة يتشغّل، رغم إن كل الـ`it()` جوّاه بينجحوا فعليًا.
Reproduction: تشغيل `npx jest s22-cross-operation-concurrency.spec.ts` (أو الـsuite كامل) — الـ`afterAll` بيرمي `QueryFailedError: update or delete on table "orders" violates foreign key constraint "chat_threads_order_id_fkey"`.
Expected: الـ`afterAll` ينضّف كل الصفوف اللي السويت أنشأها (طلبات + كل ما يتبعها) من غير أي أثر متبقي.
Actual: قبول الفني (جزء من سيناريوهات السويت) بيولّد `chat_threads` تلقائي (order_id UNIQUE FK)، بس الـ`afterAll` مكانش بيمسحه قبل محاولة مسح `orders` — فالـDELETE بتاع orders بيفشل بـFK violation، وبما إنه بيرمي استثناء، **كل سطور التنظيف اللي بعده (عناوين، بروفايلات عملاء/فنيين، مستخدمين، خدمات، فئة، منطقة) ما بتتنفذش خالص** — تسريب دائم لكل تشغيلة. اتأكد حيًا: قبل الإصلاح كان فيه 8 طلب اختبار + `chat_thread` واحد متراكمين فعليًا في قاعدة التطوير من تشغيلات سابقة في نفس الجلسة.
Root cause: ترتيب حذف ناقص في `afterAll` — `chat_messages`/`chat_threads` (اللي بيتولّدوا تلقائيًا من قبول الفني) مش موجودين في سلسلة الحذف أصلاً.
Files involved: `apps/api/src/modules/orders/s22-cross-operation-concurrency.spec.ts`
Financial/security impact: لا يوجد مباشر (بيانات اختبار بس)، لكن التسريب المتراكم عبر الوقت ممكن يبطّئ الـqueries على `orders` في بيئة التطوير، ولو تكرر في CI حقيقي هيفشل كل الـpipeline runs بعد ده.
Fix: إضافة `DELETE FROM chat_messages WHERE thread_id IN (...)` ثم `DELETE FROM chat_threads WHERE order_id IN (...)` قبل `DELETE FROM orders` في الـ`afterAll`، بنفس نمط `SELECT id FROM orders WHERE order_number LIKE 'TS22C-%'` المستخدم في باقي سطور التنظيف.
Regression test: مفيش اختبار جديد منفصل (الإصلاح في التنظيف نفسه) — الإثبات هو إن السويت بقى بيرجّع "Test Suites: 1 passed" بدل "failed to run"، واتأكد يدويًا إن `orders`/`chat_threads` بترجع لصفر بعد كل تشغيلة.
Live verification: اتشغّل السويت 1 لوحده (نجح، 8/8 اختبار) ثم فحص مباشر لقاعدة البيانات (`SELECT count(*) FROM orders WHERE order_number LIKE 'TS22C-%'` → 0، وبرضه `chat_threads` المرتبطة → 0). بعدين Full regression كامل: 91 suite، 515 اختبار، كله ناجح.
Status: FIXED

(هيتم إضافة بَقّات جديدة هنا أول ما تتأكد.)

---

## ملاحظة مرصودة — تُراجع في Phase 30 (Concurrency)

أثناء تشغيل الـsuite الكاملة مرة (91 ملف مع بعض)، `security-concurrency.spec.ts` سيناريو B
(`recordDenial` متزامن) فشل مرة واحدة (`totalOccurrences=6` بدل `5`)، لكنه نجح بثبات 3/3 مرات
لما اتشغّل لوحده. الكومنت في الاختبار نفسه بيوثّق فجوة معروفة ("سباق UPDATE...WHERE status='open'
نادر ممكن يخلّي صفين بدل واحد") بس بيفترض المجموع النهائي لسه صح — الفشل ده يقترح إن تحت ضغط
تزامن أعلى (تشغيل ملفات jest كتير بالتوازي بيزوّد التنافس الفعلي على اتصالات Postgres)، فيه
احتمال lost-update حقيقي في `SecurityEventsService.recordDenial()`. **لسه معلّق للتحقيق العميق
في Phase 30** — مش بَقّة مؤكدة لسه (نتيجة واحدة من 4 محاولات، مش reproducible بثبات).

## ملاحظات بيئة التشغيل لهذا الـaudit

- **Postgres/Redis مش Docker في البيئة دي** — مثبتين native (`service postgresql start`,
  `redis-server --daemonize yes`). لو السيشن اتقطعت، الأوامر دي لازم تتعاد قبل أي اختبار حي.
- API dev server: `cd apps/api && npm run start:dev` (بورت 3000، `/api/v1` prefix).
- كل الـmigrations (لحد `0138`) متطبقة على الداتابيز المحلية بالفعل.
