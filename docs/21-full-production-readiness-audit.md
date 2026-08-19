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
| 1 | Customer Auth & Account | Auth | VERIFIED | نعم — تسجيل حي، حذف حساب+رفض فوري لنفس التوكن، رفض تسجيل دخول برقم محذوف، عبور صلاحيات عميل↔أدمن (403 مرتين)، جلسات/logout كاملة | نعم — 50 اختبار موجود سابقًا (OTP/lockout/no-log-leak/blocked-inactive-deleted/concurrent-login/atomic-refresh/MFA step-up) + 7 اختبار جديد (`auth-self-service.spec.ts`) لـupdateMe/getMe/logout/listSessions/revokeSession IDOR/deleteMe | لا يوجد | لا يوجد (الـinvariants كلها كانت سليمة بالفعل) | لا يوجد معروف — الغطاء شامل دلوقتي (تسجيل، دخول، تجديد، خروج، حذف حساب، جلسات متعددة، IDOR) | commit قادم |
| 2 | Service Discovery | Catalog | VERIFIED | نعم — خدمة/فئة معطّلة حقيقية اتزرعت، اتأكد حيًا عبر HTTP إنها 404/مش ظاهرة في `/services`, `/service-categories`, `/estimate` | نعم — 5 اختبار جديد (`catalog-visibility.spec.ts`) + 8 موجودين سابقًا (`catalog-search.spec.ts`، Script 3 §7/§12) | لا يوجد | لا يوجد (الحماية كانت سليمة، بس بلا regression test) | `launch_phase` عمود مخزّن بس مش مستخدم كفلتر خالص (ميتادata تنظيمية فقط — `is_active` هو البوابة الفعلية) — ملاحظة تصميم موثّقة، مش بَقّة (لا يوجد "current platform phase" مفهوم في الكود يقتضي استخدامه كفلتر) | commit قادم |
| 3 | Booking Configuration (pricing fields) | Pricing | FIXED | نعم — خدمة formula حقيقية بحقل NUMBER `default_value` بره الحدود، `POST /services/:id/estimate` حي رجّع رفض واضح بدل سعر غلط | نعم — 2 اختبار جديد (`pricing-field-default-value-bypass.spec.ts`) + 5 موجودين (Script 6 Part 3/4) | BUG-003 (P1 — تسعير خاطئ بصمت) | BUG-003 fixed | لا يوجد معروف حاليًا — الفحص بقى موحّد لكل القيم (افتراضية أو من العميل) | commit قادم |
| 4 | Pricing Engine | Pricing | VERIFIED | جزئي — فحص كود ثابت + قراءة دقيقة لكل مسارات الخصم/العمولة | لا يوجد اختبار جديد مخصص (المنطق اتفحص وأثبت سليم بالقراءة، مفيش استغلال حي أمكن بناؤه) | لا يوجد | لا يوجد | **فجوة اختبار مهمة (مش بَقّة منطق)**: `OrdersService.create()` — أهم دالة في المنصة كلها — كان **مفيش لها ولا اختبار jest واحد** بيناديها مباشرة. **تحديث (Phase 5)**: أول فيكستشر jest مباشر لـ`create()` اتبنى فعلاً (`order-creation-standard-data-pairing.spec.ts`، BUG-004) وبيغطي مسار الإنتاجية/الطاقم بالكامل (سلبي+إيجابي)، لكن التغطية دي محصورة في جزء الإنتاجية بس — باقي منطق التسعير/الخصم الشامل (promo/building/formula/zone/level) لسه محتاج تغطية مباشرة، هتتوسّع في Phase 9 (Order Creation) فوق نفس الفيكستشر | commit قادم |
| 5 | Productivity / Crew Calculation | Catalog/Productivity | FIXED | نعم — `OrdersService.create()` حي (أول مرة في المشروع كله) بالحالتين السلبيتين + الحالة السليمة + الحالة العادية | نعم — 4 اختبارات جديدة (`order-creation-standard-data-pairing.spec.ts`)، أول تغطية jest مباشرة لـ`create()` | BUG-004 (P1 — متطلب طاقم بيتفقد بصمت) | BUG-004 fixed | لا يوجد معروف حاليًا — الفحص بقى XOR صريح، ونموذج الإنتاجية الخطي نفسه (توزيع الإنتاجية طرديًا مع عدد الصنايعية) لسه قرار عمل مبسّط موثّق صراحة (مش الصيغة النهائية المؤكدة من المالك) — راجع تعليق `estimateDuration()` في `catalog.service.ts` | commit قادم |
| 6 | Address / GPS / Serviceability | Addresses/Geo | FIXED | نعم — `create()`/`update()` حيين ضد Postgres حقيقي، مدينتين/منطقتين مختلفتين | نعم — 5 اختبارات جديدة (`addresses-area-city-consistency.spec.ts`) | BUG-005 (P2 — server trust boundary مفقود بين area_id/city_id) | BUG-005 fixed | لا يوجد فحص جغرافي حقيقي (point-in-polygon) على مستوى المدينة نفسها لسه — الفحص الحالي بس على مستوى نطاق الخدمة (`service_zones.boundary`) لو موجود؛ ده قرار MVP موثّق صراحة مسبقًا (§0.2.5) مش بَقّة جديدة | commit قادم |
| 7 | Booking Modes (ASAP/Scheduled) | Orders | FIXED | نعم — `OrdersService.create()` حي، طوارئ+موعد مستقبلي وطوارئ عادي | نعم — اختباران جديدان (`order-emergency-scheduled-at.spec.ts`) | BUG-006 (P1 — استجابة طوارئ بتتأجل بصمت) | BUG-006 fixed | `computeDispatchDeferredUntil()` نفسها مغطّاة بوحدة اختبار منفصلة (deferred-dispatch.util.spec.ts) وسليمة؛ الفجوة كانت في نقطة استدعائها بس. مفيش فحص مشابه لسه لباقي تركيبات bookingMode/scheduled_at غير المتوقعة (مثلاً TEAM+scheduled_at قريب جدًا من الآن) — مش عندها نفس الخطورة (مفيش رسوم طوارئ مرتبطة) فمش بَقّة، لكن تستاهل نظرة في Phase 34 (Golden Path) | commit قادم |
| 8 | Provider Selection UX & Semantics | Technicians/Matching | FIXED | جزئي — `flutter analyze` نضيف على الشاشة المعدّلة، مفيش render حي جديد (تغيير نصي إضافي بس، بلا منطق جديد) | لا يوجد اختبار جديد (تغيير UI نصي بحت، السلوك الخلفي (backend) كان مغطّى ومختبر بالفعل من Script 6) | BUG-007 (P2 — فجوة توقعات UX، مش خلل بيانات/مالي) | BUG-007 fixed | السيمانتيك الخلفي ("تفضيل مش ضمان" لـ`requested_technician_id`/`requested_technician_company_id`، "ضمان فعلي" لـ`schedule_slot_id`) قرار عمل موثّق ومختبر حي من قبل (Script 6) — سليم ومتعمّد، مش بَقّة. الفجوة كانت في التواصل مع العميل بس، دلوقتي اتقفلت في `technician_profile_screen.dart`؛ اختيار الشركة (`booking_mode=team`) كان أصلاً واضح كفاية ("بدون تفضيل" مقابل اسم الشركة) فمحتاجش تعديل | commit قادم |
| 9 | Order Creation (idempotency) | Orders | FIXED | نعم — `OrdersService.create()` حي، retry متتالي + سباق متزامن حقيقي (`Promise.all`) + مفتاح مختلف + بلا مفتاح خالص | نعم — 4 اختبارات جديدة (`order-creation-idempotency.spec.ts`) بما فيها اختبار سباق DB حقيقي | BUG-008 (P1 — مفيش حماية retry/double-click على أهم endpoint في المنصة) | BUG-008 fixed | باقي منطق التسعير الشامل (promo/building/formula/zone/level) لسه محتاج تغطية jest مباشرة أوسع فوق نفس الفيكستشر (فجوة موروثة من Phase 4، مش جديدة) | commit قادم |
| 10 | Cash Payment | Payments/Orders | VERIFIED | جزئي — راجع كل مسارات `collectCash()`/`adminConfirmCashReceived()`/`resolveCashHandoverDispute()` بالقراءة الدقيقة + شغّلت الاختبارات الحية الموجودة، مفيش استغلال حي جديد اتبنى (مفيش بَقّة اتلقطت تستاهله) | نعم — تغطية موجودة بالفعل عميقة (`cash-handover-confirmation.spec.ts`: نقر مزدوج idempotent، تعارض عميل/فني، retry بعد نزاع؛ `cash-settlement-direction.spec.ts`: اتجاه العمولة، دلتا مختلطة، عمولة صفر) | لا يوجد | لا يوجد | مفيش — `assertPayable()` + قفل pessimistic_write بيمنعوا double-collect فعليًا (اتفحص بالقراءة، القفل + فحص `paymentStatus===PAID` بعد إعادة القراءة تحت القفل كافي رياضيًا). "CASH auto-cancellation" من قايمة "items to retest" كانت أصلاً بَقّة توثيق إشعار (كود داخلي `ORDR_002` مسرّب للعميل) اتصلحت في Script 6 Phase4 — مش خلل إلغاء كاش فعلي، واتأكد إنها لسه مصلحة | commit سابق (Script 6) + هذا التحقق |
| 11 | Online Payment | Payments | VERIFIED | جزئي — راجعت `refundOrder()` بالكامل (حجز/PROCESSING/split-transaction ضد external-success-local-failure) + `payWithCard`/`payWithWallet` idempotency، مفيش استغلال حي جديد اتبنى | نعم — تغطية موجودة بالفعل عميقة (`webhook-amount-verification.spec.ts`, `webhook-recovery.service.spec.ts`, `payments.provider-outcome.spec.ts`, `refund-transaction-safety.spec.ts`) + P0-7/P0-8 (تحقق مبلغ webhook، عدم إرجاع 200 كاذب) من سيشنز سابقة | لا يوجد | لا يوجد | سيناريو "refund عالق PROCESSING للأبد" (مذكور صراحة في قايمة "known items to retest") — الكود عنده معالجة صريحة له (`refund-recovery`/reconcile يدوي مذكور في رسالة الخطأ)، لكن التحقيق العميق فيه (هل بيتصلح تلقائي؟) مؤجّل عمدًا لـPhase 17 (Refunds) — نفس مكانه المخصص في خطة الـaudit، مش هتكرر الفحص هنا | commit سابق (P0-7/P0-8) + هذا التحقق |
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

### BUG-003
Severity: P1 (financial correctness — سعر خاطئ يتحسب بصمت بدون أي رفض/تحذير)
Flow: Phase 3 (Booking Configuration — pricing fields)
Symptom: خدمة `pricing_model=formula` عندها حقل اختياري (NUMBER أو DROPDOWN) بـ`default_value`
غير صالح (بره حدود `min_value`/`max_value`، أو مش من ضمن `options`) — أي عميل ما لمسش الحقل ده
بياخد سعر محسوب من القيمة الفاسدة دي بصمت، بلا أي رفض أو تحذير.
Reproduction: حقل NUMBER بحدود `[1,100]`، `default_value='99999'`، معادلة `price_cents = area
× 100`. `evaluateDraft(serviceId, {})` (من غير `area`) رجع `priceCents=9999900` بدل رفض.
Expected: أي قيمة (سواء مبعوتة من العميل أو افتراضية) تتفحص بنفس المعيار قبل استخدامها في حساب
السعر — قيمة بره الحدود أو مش من ضمن الخيارات لازم ترفض بوضوح.
Actual: `validateAndNormalizeFieldValues()` كانت بتعمل `continue` فورًا بعد حساب القيمة
الافتراضية، فبتتخطى فحص `options`/`min_value`/`max_value` بالكامل — مسار مختصر غير محمي.
Root cause: منطق الـdefault والـvalidation كانا في نفس الدالة بس في مسارين منفصلين — المسار
الافتراضي اتضاف (Script 6 Part 3/4) من غير ما يمر على نفس فحص المسار العادي.
Files involved: `apps/api/src/modules/pricing/pricing-engine.service.ts`
Financial/security impact: سعر نهائي خاطئ للعميل (زيادة أو نقصان حسب المعادلة)، عمولة/أرباح فني
محسوبين من رقم غلط، بلا أي أثر مرئي في اللوج أو للأدمن لحد ما حد يلاحظ الفرق بالصدفة.
Fix: القيمة الافتراضية بتتحط في نفس متغيّر `value` وتكمل نفس مسار فحص options/min-max اللي أي
قيمة عميل بتتفحص بيه بالضبط — مفيش `continue` مبكر غير محمي بعد كده. رسالة الخطأ بتوضّح صراحة
لو المصدر كان القيمة الافتراضية (تسهيل تشخيص الأدمن).
Regression test: `pricing-field-default-value-bypass.spec.ts` (اختبارين، Postgres حقيقي) —
NUMBER بره الحدود وDROPDOWN بقيمة مش من ضمن الخيارات، الاتنين لازم يترفضوا بـ`VAL_001`.
Live verification: `curl` مباشر ضد dev server حقيقي — خدمة formula حقيقية بنفس الإعداد، `POST
/services/:id/estimate` رجع `400` برسالة واضحة بدل سعر `9999900` قرش. بيانات الاختبار اتنضّفت.
Status: FIXED

### BUG-004
Severity: P1 (business invariant violated silently — متطلب طاقم حقيقي بيتفقد بلا أي خطأ يوصل للعميل/الأدمن)
Flow: Phase 5 (Productivity / Crew Calculation) — `OrdersService.create()`
Symptom: خدمة عندها `service_standard_data` (يعني محتاجة حساب طاقم/مدة فعلي) — العميل بعت
`standard_data_id` بس من غير `requested_units` (أو العكس). الطلب اتسجّل عادي (201) بس
`required_technicians`/`required_assistants`/`estimated_duration_days` كلهم `null`، بلا أي
خطأ يوصل للعميل يوضّح إن الحقل التاني ناقص.
Reproduction: `OrdersService.create()` بـ`standard_data_id` بس (من غير `requested_units`) —
قبل الإصلاح: الطلب اتسجّل بنجاح بـ`requiredTechnicians=null`/`requiredAssistants=null` رغم إن
`service_standard_data` بتاعة الخدمة كانت بتفرض حد أدنى 2 صنايعي + 1 مساعد. بعد كده
`assistant-matching.service.ts:114` (`if (!order.requiredAssistants || ...) return;`) بيتخطى
مطابقة المساعدين تمامًا — استبعاد صامت لمتطلب طاقم حقيقي.
Expected: تعليق DTO نفسه (`create-order.dto.ts`) بيوثّق صراحة "الاتنين لازم يتبعتوا مع بعض أو
ولا واحد فيهم — قرار عمل من المالك". إرسال واحد بس لازم يترفض بوضوح، مش يتعامل معاه كـ"ولا
واحد".
Actual: الفحص كان `if (dto.standard_data_id && dto.requested_units)` — بيسمح بالظبط بالحالة
الممنوعة في التعليق (واحد بس) من غير أي رفض، وبيعاملها زي "ولا واحد" بصمت.
Root cause: الفحص كان AND بسيط بدل XOR — مفيش حالة صريحة تميّز "واحد ناقص" عن "الاتنين ملهمش
داعي أصلاً".
Files involved: `apps/api/src/modules/orders/orders.service.ts` (دالة `create()`)
Financial/security impact: مش مالي مباشر، لكن تشغيلي حقيقي — شغلانة تحتاج طاقم (مثلاً دهان
بمساحة كبيرة محتاجة 4 صنايعية) ممكن تتوزّع على فني واحد بلا مساعدين، يا إما الشغل يتأخر يا إما
الفني يضطر ياخد مساعدين برا النظام (بلا تتبّع/عمولة/تأمين) — فجوة عملياتية موثّقة بدل مالية.
Fix: XOR check صريح (`Boolean(dto.standard_data_id) !== Boolean(dto.requested_units)`) بيرفض
الحالة النصفية بـ`VAL_001` واضح قبل أي كتابة في الداتابيز (قبل الـtransaction بالكامل تمامًا)،
فمفيش طلب بيتسجّل بمتطلبات طاقم ناقصة بصمت.
Regression test: `order-creation-standard-data-pairing.spec.ts` (4 اختبارات، Postgres حقيقي،
أول تغطية jest مباشرة لـ`OrdersService.create()` في المشروع كله) — الاتجاهين (كل حقل لوحده)
بيترفضوا بـ`VAL_001`، الحالة السليمة (الاتنين مع بعض) بتحسب الطاقم صح فعليًا من
`service_standard_data`، والحالة العادية (ولا واحد) لسه شغالة زي زمان. اتأكد بـ`git stash` إن
الاختباران السلبيان كانوا بيفشلوا فعليًا قبل الإصلاح (الطلب كان بيتسجّل بنجاح بدل ما يترفض).
Live verification: jest حي ضد Postgres حقيقي (مش mocks) — 4/4 نجحوا بعد الإصلاح، 2/4 فشلوا
(بالشكل المتوقع) قبله. Full regression: 95 suite، 533 اختبار، كله ناجح.
Status: FIXED

### BUG-005
Severity: P2 (server trust boundary مفقود — استغلال محتاج input متعمّد غير طبيعي، مش UI عادي، لكن مفيش أي فحص server-side)
Flow: Phase 6 (Address / GPS / Serviceability) — `AddressesService.create()`/`update()`
Symptom: `city_id` و`area_id` بيتبعتوا من العميل كـUUID مستقلين بلا أي تحقق إن `area_id` فعلاً
تابع لـ`city_id` المبعوت جنبه. بما إن `findZoneForPoint()` (orders.service.ts) بيحدد نطاق
التسعير من `address.cityId` بس (مش من `areaId`)، عميل كان يقدر يبعت `city_id` لمدينة و`area_id`
لمنطقة تابعة لمدينة تانية تمامًا — العنوان بيتسجّل بـ`cityId` غير متسق مع مكانه الحقيقي.
Reproduction: `AddressesService.create(userId, {city_id: cityB, area_id: areaA})` حيث
`areaA.cityId === cityA !== cityB` — قبل الإصلاح: العنوان اتسجّل بنجاح. `update()` بنفس
المنطق: تغيير `city_id` لوحده (بلا `area_id`) أو `area_id` لوحده (بلا `city_id`) كان بيتقبل
بلا أي فحص اتساق خالص.
Expected: `area_id` لازم يترفض لو مش تابع فعليًا لـ`city_id` الناتج (سواء الاتنين اتبعتوا مع
بعض أو واحد بس مع القيمة القديمة المحفوظة).
Actual: `isAreaLaunched(areaId)` القديمة كانت بتتحقق من `area_id` لوحده بس (موجود/مفعّل/مطلق)
بلا أي مقارنة بـ`city_id`. أخطر من كده: `update()` كان بيقبل تغيير `city_id` لوحده بلا أي فحص
جغرافي خالص (مش حتى `isAreaLaunched` القديمة).
Root cause: التحقق كان مصمم حول `area_id` بس من الأول، وبعدين `city_id` اتضاف كحقل مستقل من
غير ربط رجوعي.
Files involved: `apps/api/src/modules/customers/addresses.service.ts`,
`apps/api/src/modules/geo/geo.service.ts`
Financial/security impact: مش استغلال بسيط عبر الـUI العادي (اللي غالبًا بيجيب `area_id` من
`GET /geo/cities/:id/areas` بترشيح `city_id` أصلاً)، لكنه فجوة أمان server-side حقيقية — عميل
بيتحكم في الـpayload مباشرة (curl/تعديل الطلب) يقدر "يختار" نطاق تسعير (`service_zone_pricing`)
مختلف عن مكانه الفعلي عن طريق التلاعب بـ`city_id` بعيدًا عن `area_id`/الإحداثيات الحقيقية —
خصوصًا إن كل المدن الحالية معندهاش `boundary` مرسوم (fallback لأول نطاق نشط في المدينة، زي ما
موثّق في `findZoneForPoint()`).
Fix: `GeoService.isAreaLaunchedInCity(areaId, cityId)` جديدة بتتحقق من الاتنين في استعلام واحد
(موجود/مفعّل/مطلق/تابع فعليًا لنفس المدينة). `update()` بقى بيحسب `effectiveAreaId`/
`effectiveCityId` (القيمة الجديدة أو المحفوظة) ويتحقق من الاتساق كل مرة أي منهم بيتغيّر — حتى
لو واحد بس اتبعت.
Regression test: `addresses-area-city-consistency.spec.ts` (5 اختبارات، Postgres حقيقي) —
`create()` بزوج متسق/غير متسق، و`update()` بتغيير كل حقل لوحده وبالاتنين مع بعض. اتأكد بـ
`git stash` إن 3 من الاختبارات كانوا بيفشلوا فعليًا قبل الإصلاح.
Live verification: jest حي ضد Postgres حقيقي — 5/5 نجحوا بعد الإصلاح، 3/5 فشلوا (بالشكل
المتوقع) قبله. Full regression: 96 suite، 538 اختبار، كله ناجح.
Status: FIXED

### BUG-006
Severity: P1 (استجابة طوارئ حقيقية بتتأجل ساعات بصمت رغم رسوم طوارئ مدفوعة فعليًا)
Flow: Phase 7 (Booking Modes — ASAP/Scheduled) — `OrdersService.create()`
Symptom: `booking_mode=emergency` + `scheduled_at` مستقبلي (بلا `schedule_slot_id`) كان
بيتقبل عادي. الطلب بيتسجّل بـ`orderType=EMERGENCY` و`surgeAmountCents` مطبّق فعليًا (رسوم
الطوارئ)، بس `scheduledAt` في المستقبل — وبعدين `computeDispatchDeferredUntil()` بيؤجّل بث
المطابقة الفعلي بالكامل لحد قرب الموعد ده، عكس تعريف "الطوارئ" (استجابة فورية) تمامًا.
Reproduction: `OrdersService.create()` بـ`booking_mode=emergency` و`scheduled_at` بعد 6 ساعات —
قبل الإصلاح: الطلب اتسجّل بنجاح، `surgeAmountCents=6000`، `scheduledAt` = الموعد المستقبلي —
لو كمّلنا لحد بعد الـtransaction، `dispatchDeferredUntil` كان هيتحسب ويأجّل البث فعليًا.
Expected: طلب طوارئ (docs/06) يترفض بوضوح لو اتحدد بموعد مستقبلي حر — نفس التعريف الموثّق
بالفعل في تعليق `schedule_slot_id` جوّه نفس الدالة ("الطوارئ... استجابة فورية، مش موعد مستقبلي").
Actual: الفحص القديم كان بيمنع بس تركيبة `emergency` + `schedule_slot_id` — الحقل الحر
`scheduled_at` (بلا سلوت) كان مفيش عليه أي فحص خالص.
Root cause: القاعدة اتطبّقت جزئيًا بس على مسار الجدولة الحقيقية (السلوت)، ونُسي المسار الحر
(`scheduled_at` النصي العادي) اللي بيؤدي لنفس النتيجة الممنوعة (تأجيل البث).
Files involved: `apps/api/src/modules/orders/orders.service.ts` (دالة `create()`)
Financial/security impact: مش استغلال مالي مباشر، لكن أثر تشغيلي/تجاري حقيقي — عميل دافع رسوم
طوارئ إضافية (سعر أعلى) لخدمة مفروض تكون فورية، وبدل كده بيستنى ساعات بلا أي بث مطابقة فعلي —
فجوة بين الوعد التجاري (طوارئ = فوري) والتنفيذ الفعلي.
Fix: فحص صريح `if (bookingMode === EMERGENCY && dto.scheduled_at) throw VAL_001` قبل أي منطق
تاني، بنفس مكان فحص `bookingModeAllowed`.
Regression test: `order-emergency-scheduled-at.spec.ts` (اختبارين، Postgres حقيقي، بيستخدم نفس
فيكستشر `OrdersService.create()` المباشر من BUG-004) — طوارئ+موعد مستقبلي يترفض، وطوارئ بلا
موعد (المسار السليم) لسه شغال عادي. اتأكد بـ`git stash` إن الاختبار السلبي كان بيفشل فعليًا
قبل الإصلاح (الطلب كان بيتسجّل بنجاح بـ`surgeAmountCents` مدفوع فعليًا و`scheduledAt` مستقبلي).
Live verification: jest حي ضد Postgres حقيقي — 2/2 نجحوا بعد الإصلاح، 1/2 فشل (بالشكل المتوقع)
قبله. Full regression: 97 suite، 540 اختبار، كله ناجح (باستثناء فشل عابر غير مرتبط في
`security-concurrency.spec.ts` سيناريو B — موثّق تحت، معلّق لـPhase 30).
Status: FIXED

### BUG-007
Severity: P2 (فجوة توقعات UX تجاه العميل — مش خلل بيانات/مالي، لكن ثقة حقيقية معرّضة للخطر)
Flow: Phase 8 (Provider Selection UX & Semantics) — `apps/customer-app` شاشة بروفايل الفني
Symptom: زرار "إعادة الحجز مع نفس الفني" (`technician_profile_screen.dart`) بيبعت
`requested_technician_id` للباك-إند، واللي (بتصميم متعمّد وموثّق من Script 6) **تفضيل بس مش
ضمان** — لو الفني ده مش متاح وقت التوزيع، المطابقة بترجع للتوزيع العادي بصمت (فني تاني تمامًا).
الشاشة كانت بتعرض الزرار من غير أي إشارة لطبيعة "التفضيل" دي — عميل بيدوس الزرار متوقّع إنه
حاجز نفس الفني بالظبط، ويتفاجئ لو فني تاني وصل بدل كده.
Reproduction: فتح بروفايل أي فني، الضغط على "إعادة الحجز مع نفس الفني" — مفيش أي نص في الشاشة
كلها بيوضّح إن ده تفضيل قابل للتجاوز، بعكس قسم "مواعيد فاضية" (جدولة حقيقية بـ`schedule_slot_id`،
اللي هو فعلاً ضمان حقيقي — الفني نفسه أعلن توافره في الوقت ده).
Expected: العميل يعرف بوضوح الفرق بين "تفضيل" (ممكن يتغيّر) و"موعد مؤكّد" (مضمون فعليًا) قبل
ما يدوس أي زرار — مش يكتشف الفرق بعد المفاجأة.
Actual: زرار "إعادة الحجز" وقسم "مواعيد فاضية" معروضين جنب بعض بلا أي تمييز نصي بينهم خالص.
Root cause: التصميم الخلفي (preference-vs-guarantee) اتبنى واتوثّق واتختبر حي في Script 6، لكن
التواصل مع واجهة العميل ما لحقش يتحدّث بالتوازي.
Files involved: `apps/customer-app/lib/features/technicians/technician_profile_screen.dart`
Financial/security impact: لا يوجد مباشر — مفيش فلوس/بيانات متأثرة، لكن أثر ثقة/تجربة عميل حقيقي
(توقع مخالف للواقع).
Fix: نص توضيحي مضاف تحت قسم "مواعيد فاضية" ("موعد مؤكّد — الفني نفسه أعلن إنه متاح فيه، مش
تفضيل") وتحت زرار "إعادة الحجز مع نفس الفني" ("ده تفضيل مش ضمان — لو الفني مش متاح وقت التنفيذ،
هنبعتلك أنسب فني تاني بدل ما نلغي الطلب. للتأكيد على نفس الفني ده بالظبط، احجز على واحد من
مواعيده الفاضية فوق" — بيتغيّر لو مفيش مواعيد فاضية أصلاً).
Regression test: مفيش (تغيير نصي بحت، بلا منطق/state جديد) — `flutter analyze` نضيف على الملف
المعدّل، صفر تحذيرات.
Live verification: مراجعة كود بصرية + `flutter analyze` بس (مش render حي بـXvfb — مبرَّر لأن
التغيير إضافة نص فقط بلا تعديل في التفاعل/الحالة، ومنهجية الـrender الحي التقيلة مخصصة أساسًا
لبَقّات تفاعل/رندر حقيقية زي `flutter_secure_storage` الموثّقة في نفس الـREADME).
Status: FIXED

### BUG-008
Severity: P1 (أهم endpoint في المنصة كلها بلا أي حماية ضد double-click/retry شبكة)
Flow: Phase 9 (Order Creation — idempotency)
Symptom: `POST /orders` — endpoint إنشاء الطلب، اللي بيوزّع فني حقيقي وممكن يخصم محفظة (دفع
prepaid) — كان بلا أي حماية Idempotency-Key خالص، بعكس كل عمليات الدفع
(`payments.controller.ts`) اللي بتفرض الهيدر ده صراحة (docs/01-master-plan.md §1.4). عميل
بيدوس زرار "أكّد الحجز" مرتين (شبكة بطيئة، double-tap، إعادة إرسال بعد timeout) كان يقدر ينشئ
طلبين حقيقيين لنفس النية.
Reproduction: `OrdersService.create()` بنفس الـuserId/dto مرتين متتاليتين (أو متزامنتين
بـ`Promise.all`) — قبل الإصلاح: طلبين منفصلين اتسجّلوا، فني ممكن يتوزّع مرتين لنفس النية.
Expected: نفس نمط `PaymentsService.payWithWallet()` — نفس مفتاح Idempotency-Key من نفس العميل
يرجّع نفس الطلب الأصلي، مش ينشئ نسخة جديدة، حتى تحت سباق متزامن حقيقي.
Actual: مفيش عمود `idempotency_key` أصلاً على `orders`، ومفيش أي فحص/فهرس يمنع التكرار.
Root cause: نمط الحماية اتطبّق للدفع بس (docs/01 §1.4 نص صراحة على "كل عملية دفع") ومفيش حد
مدّها لإنشاء الطلب نفسه رغم إنه بالظبط نفس فئة الخطر (mutation حقيقي بأثر مالي/تشغيلي محتمل).
Files involved: `infra/migrations/0139_orders_idempotency_key.sql`,
`apps/api/src/modules/orders/entities/order.entity.ts`,
`apps/api/src/modules/orders/orders.service.ts`,
`apps/api/src/modules/orders/orders.controller.ts`,
`apps/api/src/modules/orders/admin-orders.controller.ts`,
`apps/customer-app/lib/features/orders/orders_repository.dart`,
`apps/customer-app/lib/features/orders/create_order_screen.dart`,
`apps/customer-app/lib/features/orders/order_detail_screen.dart`,
`apps/customer-web/src/lib/orders.ts`, `apps/customer-web/src/app/services/[id]/page.tsx`
Financial/security impact: فني حقيقي بيتوزّع مرتين لنفس النية، وطلب prepaid ممكن يخصم محفظة
مرتين لو الدفع بعد الحجز اتنفّذ تلقائيًا للطلبين. تأثير تشغيلي/مالي حقيقي، مش نظري.
Fix: نفس نمط `payWithWallet()` بالحرف — عمود `idempotency_key` (migration 0139) بفهرس فريد
جزئي على `(customer_id, idempotency_key)` (`WHERE idempotency_key IS NOT NULL` — يسمح بأكتر
من NULL لنفس العميل). فحص مبكر (تحسين أداء) + الفهرس الفريد نفسه (الحماية الحقيقية ضد سباق
حقيقي) — `try/catch` حوالين الـtransaction بيمسك `23505` على الفهرس ده تحديدًا ويرجّع الطلب
الأصلي بدل ما يسرّب خطأ DB خام. الهيدر اختياري في الكونترولر (مش زي الدفع اللي بيفرضه إجباري)
عشان مانكسرش أي كلاينت قديم، لكن الكلاينتات التلاتة (customer-app، customer-web،
call-center admin) اتحدّثوا كلهم يبعتوه فعليًا — نفس درس `generateIdempotencyKey()` الموثّق في
`payments_repository.dart`: المفتاح لازم يتولّد مرة واحدة بس (state field في Dart،
`useState(() => crypto.randomUUID())` lazy initializer في React) ويتبعت تاني لأي retry، مش
يتولّد من جديد جوّه كل نداء.
Regression test: `order-creation-idempotency.spec.ts` (4 اختبارات، Postgres حقيقي) — retry
متتالي بنفس المفتاح، مفتاح مختلف بينشئ طلب تاني عادي، **سباق متزامن حقيقي** (`Promise.all`
بنفس المفتاح — بيثبت الفهرس الفريد + منطق `catch` شغالين صح مش بس الفحص المبكر)، وبلا مفتاح
خالص السلوك القديم فاضل زي ما هو. اتأكد إن الاختبارات دي كانت فاشلة **حتى في compile-time**
قبل الإصلاح (`create()` معندهوش خامس parameter خالص).
Live verification: jest حي ضد Postgres حقيقي — 4/4 نجحوا بعد الإصلاح. `flutter analyze` نضيف
على كل ملفات customer-app المعدّلة، `next build`/`tsc --noEmit` نضاف على customer-web. Full
regression: 98 suite، 544 اختبار، كله ناجح.
Status: FIXED

(هيتم إضافة بَقّات جديدة هنا أول ما تتأكد.)

---

## ملاحظة مرصودة — تُراجع في Phase 30 (Concurrency)

أثناء تشغيل الـsuite الكاملة مرة (91 ملف مع بعض)، `security-concurrency.spec.ts` سيناريو B
(`recordDenial` متزامن) فشل مرة واحدة (`totalOccurrences=6` بدل `5`)، لكنه نجح بثبات 3/3 مرات
لما اتشغّل لوحده. الكومنت في الاختبار نفسه بيوثّق فجوة معروفة ("سباق UPDATE...WHERE status='open'
نادر ممكن يخلّي صفين بدل واحد") بس بيفترض المجموع النهائي لسه صح — الفشل ده يقترح إن تحت ضغط
تزامن أعلى (تشغيل ملفات jest كتير بالتوازي بيزوّد التنافس الفعلي على اتصالات Postgres)، فيه
احتمال lost-update حقيقي في `SecurityEventsService.recordDenial()`.

**تحديث (Script 7 Phase 7، 2026-08-19)**: اتكرر مرتين تانيين بعد كده — مرة جوّه الـsuite
الكاملة (`totalOccurrences=8`)، ومرة **لوحده تمامًا** (`totalOccurrences=6`، مش تحت أي ضغط
تزامن من ملفات تانية). التكرار وهو شغال لوحده بيقلّل احتمال إنه مجرد ضغط موارد Postgres من
ملفات jest تانية — بيرفع الثقة إن فيه lost-update race حقيقي في `recordDenial()` نفسها (مش
مجرد حساسية بيئة). **لسه معلّق للتحقيق العميق في Phase 30** زي ما كان مخطط، لكن بثقة أعلى إنها
بَقّة حقيقية مش ضوضاء — 3 من ~6 محاولات إجمالية فشلت لحد دلوقتي.

## ملاحظات بيئة التشغيل لهذا الـaudit

- **Postgres/Redis مش Docker في البيئة دي** — مثبتين native (`service postgresql start`,
  `redis-server --daemonize yes`). لو السيشن اتقطعت، الأوامر دي لازم تتعاد قبل أي اختبار حي.
- API dev server: `cd apps/api && npm run start:dev` (بورت 3000، `/api/v1` prefix).
- كل الـmigrations (لحد `0138`) متطبقة على الداتابيز المحلية بالفعل.
