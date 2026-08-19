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
| 12 | Dispatch & Matching | Matching | VERIFIED | جزئي — راجعت `matching.service.ts` (ترتيب دفعات، أولوية مستوى، تفضيل فني/شركة مع fallback) بالقراءة، مفيش استغلال جديد اتبنى | نعم — تغطية موجودة بالفعل (اختبارات حية موثّقة في matching/README.md للطوارئ، تفضيل الشركة، fallback) | لا يوجد | لا يوجد | مفيش | commit سابق + هذا التحقق |
| 13 | Capacity / Multi-worker Jobs | Matching/Crew | VERIFIED | نعم — أكّدت إن `matching.service.ts` بيوزّع قائد واحد بس، `assistant-matching` بيغطي `requiredAssistants` بس، و`requiredTechnicians>1` (طاقم كامل) قصده الإداري (`crewShortage` indicator، admin crew editing tool) مش تلقائي بالكامل — قرار عمل موثّق صراحة، مش بَقّة | نعم — `admin-crew-management.spec.ts` (14 اختبار) يغطي هذا المسار بالكامل بما فيه `crewShortage` | لا يوجد | لا يوجد | التوليد التلقائي الكامل لأكتر من فني قائد واحد مش مطبّق (owner نفسه أكّد "الحساب مش موجود حاليا") — فجوة موثّقة صراحة من قبل، مش جديدة | commit سابق + هذا التحقق |
| 14 | Technician App | Technician-app | FIXED | جزئي — `flutter analyze` نضيف (0 أخطاء) على الشاشة الجديدة والملفات المعدّلة، مفيش render حي (Xvfb) — تغيير إضافي بحت مبرَّر بنفس منطق BUG-007 | لا يوجد اختبار jest جديد (تغيير Dart-only، الـendpoint المُستخدم مغطّى backend من قبل بـIDOR fix موثّق) | BUG-009 (P2 — فني قائد لطلب "اعتماد" معندوش أي رؤية لطاقمه في التطبيق) | BUG-009 fixed | إضافة/إزالة عضو طاقم من التطبيق نفسه (مش بس عرض) لسه مش موجودة — الباك-إند جاهز (`POST`/`DELETE .../team-members`) بس الشاشة الجديدة read-only عمدًا (نطاق محدود لإصلاح فجوة الرؤية الأساسية، مش إعادة بناء الشاشة بالكامل) | commit قادم |
| 15 | Order State Machine | Orders | VERIFIED | جزئي — راجعت `ORDER_TRANSITIONS` كامل (`Record<OrderStatus,...>` بيفرض شمولية compile-time، أي حالة ناقصة = خطأ tsc)، مفيش استغلال جديد اتبنى | نعم — `order-state-machine.spec.ts` موجود من قبل | لا يوجد | لا يوجد | مفيش | commit سابق + هذا التحقق |
| 16 | Cancellations | Orders | VERIFIED | جزئي — راجعت `CUSTOMER_CANCELLABLE_STATUSES`/سياسة إلغاء الفني (docs/10)، مفيش استغلال جديد اتبنى (نطاق عميق اتغطى في سيشنز سابقة: P0-9، endpoint إلغاء الفني، رسوم الإلغاء) | نعم — تغطية موجودة بالفعل عميقة عبر عدة ملفات spec | لا يوجد | لا يوجد | مفيش | commit سابق + هذا التحقق |
| 17 | Refunds | Payments | PARTIAL | نعم — أعدت تشغيل سيناريو "throw أثناء نداء البوابة" الموجود من قبل (يثبت استرداد عالق PROCESSING فعليًا) + `listRefunds()` الجديدة عليه مباشرة | نعم — امتداد لاختبار موجود (`refund-transaction-safety.spec.ts`) بنفس الفكستشر اللي بيثبت السيناريو الحقيقي أصلاً | BUG-010 (P1 — استرداد عالق PROCESSING بلا أي رؤية إدارية) | BUG-010 fixed جزئيًا (الرؤية بس) | **قرار عمل مطلوب**: `provider.reconcile()` موجود في الـinterface ومطبّق فعليًا لـPaymob بس **مش متصل بأي endpoint/job خالص** — التسوية التلقائية الكاملة (نداء reconcile فعليًا وإكمال الاسترداد تلقائيًا) لسه مش مبنية عمدًا (خطر حقيقي: منطق مالي معقّد — عكس أرباح الفني، قيد مزدوج، تجميع "الطلب اتراد بالكامل" عبر أكتر من دفعة — يحتاج بناء + اختبار حي ضد Paymob sandbox حقيقي، خارج نطاق آمن لتغيير عاجل بلا اختبار خارجي حقيقي). مصنّفة NEEDS BUSINESS DECISION جزئيًا | commit قادم |
| 18 | Wallet / Ledger / Commission | Wallets | FIXED | جزئي — راجعت `WalletsService` بالكامل (`doubleEntry`/`reverseDoubleEntry`/`reserveForPayout`/`releaseReservation`/`finalizePayout`) بالقراءة الدقيقة (كان اتفحص بعمق في سيشن سابقة، task #36) + تتبعت كل مسارات `doubleEntry(` الحقيقية عبر الموديولات (orders/refunds/domestic-workers/technician-referrals) لأي استدعاء خارج الأنماط المعروفة، مفيش استغلال حي جديد اتبنى في المحرك نفسه (سليم رياضيًا: قفل بترتيب ثابت، فحص `allowNegativeBalance` بعد القفل مباشرة، `WITHDRAWAL` مقصور على `finalizePayout` بلا مسار موازي) | لا يوجد اختبار jest جديد للمحرك نفسه (كان مغطّى بعمق من قبل) — الإصلاح الوحيد ده توثيقي بحت (README)، فمفيش سلوك برمجي يحتاج regression test | BUG-011 (P3 — توثيق `domestic-workers/README.md` كان بيحيل غلط لـ`refunds.issue` كمسار استرداد عملي لحجوزات العمالة المنزلية، رغم إنها 404 دايمًا لغياب صف `Order`) | BUG-011 fixed (توثيقي) | حجز عمالة منزلية اتلغى بعد `confirm()` (الفلوس اتحصّلت فعليًا من العميل) مفيهوش استرداد تلقائي في v1 — قرار عمل موثّق صراحة من قبل (مش بَقّة)، بس المسار الإداري الفعلي (`wallets.adjust`) محتاج معرفة يدوية بالمبلغ الصحيح (مفيش زرار "استرد الحجز ده" جاهز) — فجوة تشغيلية أصغر، تستاهل UI مخصص مستقبلاً لو الحجم كبر | commit قادم |
| 19 | Provider Payouts | Payouts | VERIFIED | جزئي — راجعت `PayoutsService` بالكامل بالقراءة (`requestPayout`/`reserveForPayout` lock/فحص رصيد، `adminApprove`/`adminReject`/`adminComplete` كلهم بقفل `pessimistic_write` + فحص حالة صريح، `linkOrderItemsForPayout` تفصيل توضيحي بس مش قيد محاسبي)، مفيش استغلال حي جديد اتبنى | نعم — تغطية موجودة بالفعل عميقة جدًا (`payout-double-release.spec.ts`: نداء `adminReject` مرتين، `releaseReservation` مباشر، approve×reject، complete×complete، complete×reject، rollback عند فشل audit) | لا يوجد | لا يوجد | مفيش رصد جديد — auto-approve (`payouts.auto_approve_limit_cents`) بيتخطى مراجعة UNDER_REVIEW بس لسه محتاج `adminComplete()` (صلاحية+step-up) عشان الفلوس تتحرك فعليًا، فمفيش تحويل فلوس تلقائي بالكامل بلا لمسة إنسان — تصميم متعمّد سليم. مفيش endpoint للفني يلغي طلب صرف UNDER_REVIEW بنفسه (لازم يعدي عبر admin reject) — قرار تصميم متسق مع باقي العمليات المالية الحساسة في المشروع، مش بَقّة | commit سابق + هذا التحقق |
| 20 | Promo / Referral / Discounts | Promotions | VERIFIED | جزئي — راجعت `PromoCodesService` بالكامل بالقراءة (`computeDiscount` حدود صريحة صفر↔إجمالي الطلب، `assertUsable` كل الشروط بما فيها `restrictedToUserId`/`budgetCents`، `validateAndApply` بقفل ذرّي `pessimistic_write` جوّه transaction الطلب، `releaseUsage` idempotent بقفل ذرّي) + تتبعت كل مسارات إلغاء الطلب (`orders.service.ts` عميل، `order-auto-cancel.service.ts` نظام×2، `admin-orders.service.ts` أدمن) للتأكد كلهم بينادوا `releaseUsage` — و`technicianCancel()` بالذات اتأكد إنها **لا** تنادي `releaseUsage` عن قصد صحيح (بتنقل الطلب لإعادة مطابقة/اختيار بديل، مش إلغاء نهائي — الكود ما زال قيد الاستخدام فعليًا)، مفيش استغلال حي جديد اتبنى | نعم — تغطية موجودة بالفعل عميقة (`promo-code-usage-release.spec.ts`: idempotent، no-op لطلب بلا كود) + `referral-integrity.spec.ts`/`technician-referral-financial-integrity.spec.ts` للترشيح | لا يوجد | لا يوجد | مفيش رصد جديد — referrals تستخدم آلية إصدار كود خصم (`issueRewardInTransaction`) مش تحويل محفظة مباشر للعميل (يوصل عبر `PromoCodesService`/`assertUsable`)، بعكس مكافآت ترشيح الفنيين (`technician-referrals.service.ts`) اللي بتحوّل محفظة مباشرة — تصميمان مختلفان متعمّدان لنوعين مختلفين من الترشيح، موثّقان بالفعل | commit سابق + هذا التحقق |
| 21 | Completion | Orders | VERIFIED | جزئي — راجعت `transitionAsTechnician()`/`complete()` بالقراءة الدقيقة: فحص after_photo إجباري (docs/08 §20 بند 12) برّه الـtransaction (قراءة بس، آمن)، قفل `pessimistic_write` + إعادة فحص `orderStatus===previousStatus` جوّه الـtransaction يمنع double-complete فعليًا (double-click حقيقي: النداء التاني هيلاقي الحالة اتغيّرت ويترفض 409)، مفيش استغلال حي جديد اتبنى | نعم — `order-state-machine.spec.ts` يغطي شمولية الانتقالات، `cash-handover-confirmation.spec.ts` يغطي نقر مزدوج على `collectCash` بعد الاكتمال | لا يوجد | لا يوجد | مفيش رصد جديد — لطلب `booking_mode=team` بس الفني القائد (`order.technicianId`) هو اللي بينادي `complete()`، أعضاء الطاقم معندهمش بوابة تأكيد مستقلة — نفس القرار الإداري الموثّق بالفعل في Phase 13 (`crewShortage` indicator)، مش بَقّة جديدة | commit سابق + هذا التحقق |
| 22 | Ratings & Reviews | Ratings | VERIFIED | جزئي — راجعت `RatingsService` بالكامل بالقراءة: `assertRatable` (لازم COMPLETED)، `createRating` بفحص تكرار مزدوج (فحص منطقي + `UNIQUE` على `ratings.order_id` كخط دفاع أخير ضد سباق نادر)، ملكية الطلب متحقق منها في `rateAsCustomer`/`rateAsTechnician` (`customerId`/`technicianId` في الـwhere)، `after_photo_media_ids` متحقق إنها بتاعة نفس الطلب، مفيش استغلال حي جديد اتبنى | لا يوجد اختبار jest جديد (المنطق اتأكد سليم بالقراءة، السباق النادر مغطّى بـUNIQUE constraint فعلي مش code path يحتاج اختبار جديد) | لا يوجد | لا يوجد | `ratings.order_id` UNIQUE يعني تقييم واحد بس لكل طلب (مش تقييمين، واحد من كل طرف) — أول طرف يقيّم ياخد السلوت، قرار موثّق صراحة من `docs/02-data-dictionary.md §8.1` نفسه (الكود بيعلّق عليه بالحرف: "لو غلط لازم يتصحح بتحديث موثّق للقاموس، مش هنا بصمت") — مش بَقّة جديدة، قرار عمل قائم من الأساس | commit سابق + هذا التحقق |
| 23 | Warranty / Revisit | Orders/Warranty | FIXED | نعم — `OrdersService.create()` حي، إعادة زيارة سليمة (طلب أصلي standard) + محاولة سلسلة (إعادة زيارة لإعادة زيارة) | نعم — 2 اختبار جديد (`order-revisit-chain.spec.ts`) | BUG-012a (P1 — سلسلة إعادة زيارات مجانية بلا نهاية) | BUG-012a fixed | مفيش رصد جديد بعد الإصلاح — الفحص بقى صريح على `orderType` بدل الاعتماد الضمني على `warrantyExpiresAt` بس | commit قادم |
| 24 | Complaints / Support | Support | FIXED | لا (بَقّة metadata-level، نفس منهجية `mfa-step-up-enforcement.spec.ts` الموجودة أصلاً — لا تحتاج Postgres حي) | نعم — امتداد لـ`mfa-step-up-enforcement.spec.ts` الموجود (حالة جديدة لـ`AdminSupportController.resolve`) | BUG-012b (P1 — `complaints.resolve` بيحوّل فلوس تعويض بلا حد أقصى من غير step-up إجباري) | BUG-012b fixed | راجعت `resolve()`/`reject()`/`close()`/`updateSeverity()` بالكامل — قفل `pessimistic_write` + فحص `canTransitionComplaint` بيمنعوا حل/رفض مزدوج، مفيش مشكلة تانية | commit قادم |
| 25 | Admin Control Plane | Admin | FIXED | نعم — `AdminCustomersService.delete()`/`AuthService.deleteMe()` حيين ضد Postgres حقيقي، رصيد محفظة >0 يمنع الحذف، تصفير الرصيد يسمح بيه | نعم — اختبار جديد في `admin-customer-delete.spec.ts` + `auth-self-service.spec.ts` (رفض ثم نجاح بعد التصفير) | BUG-013 (P1 — حذف حساب عنده رصيد محفظة حقيقي بيحبس الفلوس بلا مسار استرجاع) | BUG-013 fixed | راجعت `AdminEmployeesService.delete()` بالمقارنة — مفيش نفس الفجوة (الموظفين مالهمش `WalletOwnerType` خالص، الفحص مش مطلوب هناك) — سليم كما هو. باقي الـcontrol plane (customers list/block/unblock، employees CRUD، reports) اتراجع بالقراءة السريعة، مفيش استغلال جديد اتلاقط | commit قادم |
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

### BUG-009
Severity: P2 (فجوة تشغيلية حقيقية — مش خلل بيانات/مالي، لكن فني قائد بلا رؤية طاقمه فعليًا)
Flow: Phase 13/14 (Capacity/Multi-worker Jobs، Technician App)
Symptom: الباك-إند عنده `GET/POST/DELETE /technician/orders/:id/team-members` جاهزة ومؤمّنة
بالكامل (IDOR fix موثّق من قبل، `findOwnedByTechnicianOrThrow`) — لكن `apps/technician-app`
كان معندوش أي إشارة لمفهوم "طاقم" خالص: نموذج `Order` نفسه ما كانش بيقرأ `booking_mode` من
الباك-إند أصلاً. فني قائد على طلب "اعتماد" (`booking_mode=team`) بيفتح التطبيق ومعندوش أي طريقة
يشوف بيها مين المُعيَّن معاه في الطاقم، ولا هل الطاقم كامل حسب `required_technicians`.
Reproduction: فتح شاشة تنفيذ طلب `booking_mode=team` في `apps/technician-app` — صفر إشارة لأي
عضو طاقم، صفر أي نص "طاقم الطلب" خالص في الشاشة كلها.
Expected: الفني القائد يقدر يشوف طاقمه الحالي (الأسماء/الأدوار) وهل العدد كافي، زي ما العميل
والأدمن بيشوفوا بالفعل (موثّق في orders/README.md: "معروض في الواجهات: apps/admin وapps/customer-app").
Actual: صفر رؤية خالص من جانب الفني القائد نفسه.
Root cause: نموذج `Order` في `apps/technician-app` (`order.dart`) اتبني قبل مفهوم "اعتماد"
(booking_mode=team) يتضاف للمنصة، وما اتحدّثش لما الميزة اتضافت لاحقًا في apps/admin/customer-app.
Files involved: `apps/technician-app/lib/features/orders/order.dart`,
`apps/technician-app/lib/features/orders/models.dart`,
`apps/technician-app/lib/features/orders/orders_repository.dart`,
`apps/technician-app/lib/features/orders/order_execution_screen.dart`
Financial/security impact: لا يوجد مباشر — الباك-إند نفسه كان مؤمّن بالفعل، الفجوة كانت في
التطبيق بس. أثر تشغيلي حقيقي: فني قائد على شغلانة محتاجة طاقم كبير ممكن يوصل مكان الشغل بلا أي
فكرة عن باقي الطاقم.
Fix: `Order.fromJson()` بقى بيقرأ `booking_mode`/`required_technicians`. `TeamMember` model
جديد + `OrdersRepository.fetchTeamMembers()` بينادي الـendpoint الموجود بالفعل. كارت "طاقم
الطلب" جديد (read-only) في `order_execution_screen.dart` — بيظهر بس لـ`booking_mode=team`،
بيحمّل الطاقم بنفس فلسفة `_loadMedia()` (فشل التحميل مايكسرش باقي الشاشة)، وبيعرض تحذير عددي
لو `required_technicians` معروف.
Regression test: مفيش اختبار jest جديد (الـendpoint نفسه مغطّى backend من قبل، والتغيير هنا
Dart-only إضافي). `flutter analyze` نضيف على كل الملفات المعدّلة (0 أخطاء) — لقط بَقّة تجميع
حقيقية أثناء الفحص (استدعاء `Order()` يدوي بعد `collect-cash` كان محتاج `bookingMode` الجديد
كـparameter مطلوب، اتصلح بالمرة).
Live verification: `flutter analyze` بس (مش render حي بـXvfb) — مبرَّر لأن التغيير إضافة قسم
جديد مقفول خلف شرط (`bookingMode=='team'`) بلا تعديل في أي منطق موجود، ومنهجية الـrender الحي
التقيلة مخصصة أساسًا لبَقات تفاعل/رندر حقيقية (نفس تبرير BUG-007). طلبات `booking_mode=individual`
(الأغلبية الساحقة حاليًا) مش متأثرة خالص — القسم الجديد مش بيظهر ليهم أصلًا.
Status: FIXED

### BUG-010
Severity: P1 (استرداد عالق ببلاش فلوس عميل — لا مسترد ولا متتبَّع، مالوش أي رؤية إدارية)
Flow: Phase 17 (Refunds) — التحقيق الصريح المطلوب في "known items to retest" ("refund stuck in
PROCESSING")
Symptom: `refundOrder()` بتسجّل صف `Refund` بحالة PROCESSING **قبل** نداء بوابة الدفع الخارجي
(تصميم متعمّد وصحيح لمنع استرداد مزدوج)، لكن لو النداء نفسه رمى استثناء (شبكة اتقطعت، timeout)،
الصف يفضل PROCESSING **للأبد** — رسالة الرفض بتقول للأدمن "راجع الطلب يدويًا (provider.reconcile)"،
لكن `provider.reconcile()` **مش متصل بأي endpoint أو job خالص** — طريقة الحل الموصوفة مش موجودة
فعليًا كـعملية قابلة للاستدعاء. وأخطر من كده: **مفيش أي endpoint كان بيرجّع قايمة استردادات
خالص** — الأدمن معندوش طريقة يعرف إن فيه استرداد عالق من الأساس غير استعلام DB مباشر.
Reproduction: `refund-transaction-safety.spec.ts` عنده سيناريو موجود بالفعل من قبل ("نداء البوابة
رمى استثناء") بيثبت ده حيًا: صف Refund بيفضل `PROCESSING` بعد استثناء البوابة، ومحاولة استرداد
تانية بترفض فورًا (409) — يعني الاسترداد ده مقفول تمامًا بلا أي طريقة يتقفل بيها.
Expected: الأدمن (على الأقل) يقدر يشوف كل الاستردادات العالقة في PROCESSING عشان يتصرف (حتى لو
التصرف نفسه لسه يدوي عبر لوحة تحكم Paymob مباشرة مؤقتًا).
Actual: صفر رؤية، صفر endpoint، صفر أثر — `provider.reconcile()` كود ميت عمليًا.
Root cause: التصميم الأصلي (توثيق صريح في الكود نفسه) اعتبر التسوية اليدوية "خارج نطاق" وقت
بناء إصلاح الـdistributed-transaction، لكن حتى "اليدوي" ده محتاج نقطة دخول — ماتبنتش.
Files involved: `apps/api/src/modules/payments/payments.service.ts`,
`apps/api/src/modules/payments/admin-payments.controller.ts`,
`apps/api/src/modules/payments/dto/payments-response.dto.ts`,
`apps/api/src/modules/payments/dto/list-refunds-query.dto.ts`,
`infra/migrations/0140_refunds_view_permission.sql`
Financial/security impact: مباشر — فلوس عميل (أو فني، حسب اتجاه الاسترداد) ممكن تفضل "معلّقة"
غير مؤكّدة لا عند العميل ولا عند المنصة، بلا أي تنبيه لحد يلاحظ غير مراجعة يدوية للـDB.
Fix (جزء منفّذ الآن): `PaymentsService.listRefunds(status?)` + `GET /admin/refunds?status=...`
(صلاحية جديدة `refunds.view`، migration 0140، نفس نمط `payouts.view`/`wallets.view` من قبل) —
الأدمن دلوقتي يقدر يشوف كل الاستردادات، وتحديدًا يفلتر `processing` عشان يلاقي العالقة. الـDTO
اتوسّع بحقول مفيدة للمراجعة (`payment_id`, `refund_method`, `requested_at`, `provider_refund_id`).
Fix (جزء مؤجّل عمدًا — قرار عمل مطلوب): التسوية التلقائية الكاملة (نداء `provider.reconcile()`
فعليًا + تطبيق أثرها المالي بنفس منطق phase (c) الحالي في `refundOrder()`) **متعمّد التأجيل** —
منطق مالي حساس جدًا (عكس أرباح فني متناسب، قيد مزدوج، تجميع حالة "الطلب اتراد بالكامل" عبر أكتر
من دفعة) يحتاج بناء دقيق + اختبار حي ضد Paymob sandbox حقيقي (مش mock)، وده خارج نطاق آمن لبناء
تحت ضغط وقت بلا القدرة على اختبار خارجي فعلي هنا. مصنّفة NEEDS BUSINESS DECISION — القرار
المطلوب من المالك: هل نبني endpoint إداري صريح "حاول تسوية الاسترداد ده تاني" (يستدعي reconcile
فعليًا)، ولا نكتفي بالرؤية + تسوية يدوية عبر Paymob dashboard مباشرة كسياسة تشغيلية مقبولة؟
Regression test: امتداد للاختبار الموجود بالفعل (`refund-transaction-safety.spec.ts`، سيناريو
"throw") — أضفت assertion إن `listRefunds(PROCESSING)` بترجّع نفس الصف العالق اللي الاختبار
أثبت عالقته فعليًا. اتأكد بـ`tsc`/تشغيل الاختبار إن الميثود الجديدة صحيحة، والاختبار مايبنيش على
افتراض نظري (نفس البيانات اللي الاختبار الأصلي أثبتها عالقة).
Live verification: jest حي ضد Postgres حقيقي (7/7 نجحوا). Full regression: 98 suite، 544
اختبار — نجحوا كلهم غير فشل عابر غير مرتبط (`security-concurrency.spec.ts`، موثّق ومؤجّل لـPhase 30
من قبل، اتأكد إنه مش ناتج عن التغيير ده بإعادة تشغيله لوحده والسويت كله مرتين تانيين).
Status: PARTIAL (الرؤية اتصلحت، التسوية التلقائية الكاملة NEEDS BUSINESS DECISION)

### BUG-011
Severity: P3 (توثيق مضلِّل لمسار مالي إداري — مفيش أثر مالي مباشر، بس خطر تشغيلي حقيقي لو حد اتبع التوثيق حرفيًا)
Flow: Phase 18 (Wallet / Ledger / Commission) — تتبع مسارات `doubleEntry()` كلها عبر الموديولات
غير `payments`/`orders` (referral bonuses، domestic-worker earnings) بحثًا عن أي مسار مالي جديد
مش متسق مع محرك المحفظة المركزي.
Symptom: `domestic-workers/README.md` (سطرين، قسم الإلغاء وقسم الرفض) بيوثّق إن استرداد فلوس
عميل بعد إلغاء حجز عمالة منزلية مؤكَّد (الفلوس اتحصّلت فعليًا في `confirm()` عبر `WalletTxType.ADJUSTMENT`
مباشر لمحفظة المنصة، بلا صف `Payment`/`Order` خالص) "قرار منفصل عبر `refunds.issue` الموجود أصلاً
لو مطلوب".
Reproduction: تتبعت `PaymentsService.refundOrder(performedByUserId, orderId, ...)` — أول سطر
بيدوّر على `Order` بـ`orderId` (`this.orders.findOne({ where: { id: orderId, ... } })`). حجوزات
العمالة المنزلية (`DomesticWorkerBooking`) مالهاش صف `Order` خالص — استخدام `refunds.issue` بـ
`booking_id` كـ`orderId` هيرجّع `404 الطلب غير موجود` دايمًا، مش استرداد حقيقي.
Expected: التوثيق يوجّه لمسار إداري فعليًا قابل للاستخدام.
Actual: التوثيق كان بيوجّه لمسار 404 دايمًا — أي أدمن/دعم فني حاول يتبع التوثيق حرفيًا كان هيتفاجئ
بفشل صامت وقت محاولة استرداد فلوس عميل حقيقي.
Root cause: توثيق اتكتب بافتراض إن `refunds.issue` مسار عام لأي استرداد في المنصة، من غير تتبع
فعلي لتوقيعها (`orderId`-scoped حصريًا) ضد نموذج بيانات حجوزات العمالة المنزلية (بدون `Order` أصلاً).
Files involved: `apps/api/src/modules/domestic-workers/README.md` (توثيق فقط — صفر تغيير كود/سلوك)
Financial/security impact: غير مباشر — لا يوجد خلل في حركة الفلوس نفسها (الفلوس فعلاً بتفضل عند
المنصة زي ما هو موثّق ومقصود، `wallets.adjust` قادر يسترجعها يدويًا وده مسار موجود ومختبر أصلاً
عبر `wallet-manual-adjustment.spec.ts`) — الخطر هو تشغيلي بحت: عملية استرداد حقيقية مطلوبة ممكن
تتأخر أو تفشل لو الموظف اتبع التوثيق الغلط بدل ما يعرف يستخدم `wallets.adjust`.
Fix: صححت السطرين في `domestic-workers/README.md` ليوضحوا إن `wallets.adjust`
(`PATCH /admin/wallets/:userId/adjust`) هو المسار العملي الوحيد المتاح حاليًا، ووضحت صراحة ليه
`refunds.issue` مش قابل للاستخدام هنا (غياب صف `Order`).
Regression test: N/A — إصلاح توثيقي بحت، صفر سلوك برمجي اتغيّر (لا كود، لا migration، لا DTO).
لا يوجد "قبل/بعد" قابل للاختبار آليًا لتصحيح نص README.
Live verification: N/A لنفس السبب — تأكدت من صحة الادعاء الجديد بقراءة `refundOrder()`'s
signature/lookup مباشرة (مذكور فوق في Reproduction)، مش باختبار حي (لا يوجد سلوك يتغيّر ليُختبر).
Status: FIXED (توثيقي)

### BUG-012a
Severity: P1 (خدمة مجانية بلا نهاية — الفني ما بيتعوّضش، المنصة بتخسر إيراد متكرر بلا حد)
Flow: Phase 23 (Warranty / Revisit)
Symptom: إعادة زيارة تحت الضمان (`order_type=revisit`, `POST /orders` بـ`original_order_id`) بتاخد
`warranty_expires_at` **جديدة بالكامل** وقت اكتمالها (نفس `settleAndComplete()` اللي بتحسبها لأي
طلب مكتمل، بلا أي استثناء لـ`order_type=revisit`) — ومفيش أي فحص كان بيمنع إعادة الزيارة نفسها
من إنها تبقى `original_order_id` لإعادة زيارة تانية.
Reproduction: طلب أصلي مدفوع مكتمل (ضمان 30 يوم) → إعادة زيارة مجانية بنجاح (متوقع وصحيح) →
إعادة الزيارة دي تكتمل هي كمان → وقت الاكتمال بتاخد `warranty_expires_at` جديدة بنفس الـ30 يوم
كاملة (مش وريث/باقي من الضمان الأصلي) → العميل يقدر يطلب إعادة زيارة تانية بـ`original_order_id`
= إعادة الزيارة الأولى (مش الطلب الأصلي) → تنجح → تكرار للأبد طالما العميل بيطلب إعادة زيارة
جديدة قبل ما ضمان آخر واحدة يخلص.
Expected: "إعادة زيارة تحت الضمان" معناها "نصلح نفس المشكلة تاني لو رجعت مرة واحدة" — مش سلسلة
خدمات مجانية بلا حد لنفس العميل/العنوان/الخدمة.
Actual: مفيش أي حد أقصى — سلسلة كاملة من الطلبات المجانية ممكنة نظريًا للأبد.
Root cause: `settleAndComplete()` بتحسب `warranty_expires_at` لأي طلب مكتمل بلا تفرقة بين
`order_type=standard`/`revisit`، والفحص عند إنشاء إعادة زيارة كان بيتأكد بس من `orderStatus=COMPLETED`
+ نفس الخدمة/العنوان + `warrantyExpiresAt` سارٍ — من غير أي فحص على `orderType` بتاع الطلب الأصلي نفسه.
Files involved: `apps/api/src/modules/orders/orders.service.ts`,
`apps/api/src/modules/orders/order-revisit-chain.spec.ts` (جديد)
Financial/security impact: مباشر — إيراد مفقود متكرر (المنصة/الفني ملهمش أي تعويض عن شغل بعد
أول إعادة زيارة)، واستغلال متعمد ممكن من عميل يعرف الآلية.
Fix: فحص صريح جديد — لو `originalOrder.orderType === OrderType.REVISIT`، الطلب بيترفض بوضوح
(`VAL_001`) بدل ما يتقبل بصمت. إعادة الزيارة تفضل مسموحة مرة واحدة بس لكل طلب أصلي مدفوع حقيقي.
Regression test: `order-revisit-chain.spec.ts` (اختباران) — إعادة زيارة لطلب أصلي عادي بتنجح
(تأكيد المسار السليم لسه شغال)، وإعادة زيارة لإعادة زيارة تانية بترفض `VAL_001` — الاختبار الثاني
كان هيفشل قبل الإصلاح (الطلب كان هينجح بدل ما يترفض) عبر `git stash` على `orders.service.ts` بس
مع الإبقاء على الاختبار الجديد.
Live verification: jest حي ضد Postgres حقيقي.
Status: FIXED

### BUG-012b
Severity: P1 (تحويل فلوس حقيقي بقرار أدمن بلا أي تأكيد MFA/step-up حديث)
Flow: Phase 24 (Complaints / Support) — اتلقطت أثناء مراجعة `SupportService.resolve()` لأي حركة
محفظة جديدة بعد Phase 18-20
Symptom: `POST /admin/complaints/:id/resolve` بيحوّل `compensation_cents` (مبلغ يحدده الأدمن نفسه،
بلا حد أقصى، `allowNegativeBalance:true`) مباشرة من محفظة المنصة للطرف اللي اشتكى — بنفس بالظبط
حساسية `orders.resolve_failed_visit`/`orders.resolve_cash_dispute`/`wallets.adjust` الموجودين
فعلاً في `MFA_REQUIRED_PERMISSIONS` + `@RequireStepUp()`، لكن `complaints.resolve` كانت غايبة
تمامًا من القايمة والـendpoint من غير `@RequireStepUp()` خالص.
Reproduction: `mfa-step-up-enforcement.spec.ts` (اختبار metadata بسيط بلا Postgres، نفس النمط
اللي كشف نفس الفئة أربع مرات قبل كده — `wallets.adjust`/`orders.adjust_price`/
`payments.confirm_manual`/`settings.manage`) — حالة جديدة لـ`AdminSupportController.resolve`
كانت هتفشل قبل الإصلاح على شقّين: `MFA_REQUIRED_PERMISSIONS` ماكانتش تحتوي `complaints.resolve`
خالص، و`stepUpMetadata(handler)` كانت `undefined` (`StepUpGuard` بيبقى no-op تمامًا من غير
`@RequireStepUp()` الفعلية).
Expected: أي endpoint بيحوّل فلوس حقيقية بقرار أدمن مباشر لازم step-up إجباري، نفس المبدأ الحاكم
الموثّق في `mfa-policy.service.ts` نفسه.
Actual: جلسة أدمن مسروقة (حتى بصلاحية `complaints.resolve` بس — ممكن تتمنح لموظف دعم عادي، مش
لازم `super_admin`/`finance`) كانت تقدر تحوّل فلوس حقيقية بلا أي تأكيد Passkey حديث خالص.
Root cause: `complaints.resolve` اتضافت كصلاحية مالية جديدة (تعويض شكوى) من غير ما تتضاف لنفس
القائمة/الحماية اللي كل صلاحية مالية تانية مماثلة اتضافتلها.
Files involved: `apps/api/src/modules/auth/mfa-policy.service.ts`,
`apps/api/src/modules/support/admin-support.controller.ts`,
`apps/api/src/modules/auth/mfa-step-up-enforcement.spec.ts`
Financial/security impact: مباشر — تحويل فلوس حقيقي بلا حماية step-up، نفس فئة P0 الأربع بَقّات
السابقة بالحرف.
Fix: `complaints.resolve` اتضافت لـ`MFA_REQUIRED_PERMISSIONS` (يفرض MFA إجباري وقت الدخول لأي
حساب عنده الصلاحية دي) + `@RequireStepUp()` اتضافت فعليًا على `AdminSupportController.resolve()`.
`reject()`/`close()`/`updateSeverity()` اتسيبوا من غير step-up عمدًا — مفيش حركة فلوس فيهم.
Regression test: حالة جديدة في `mfa-step-up-enforcement.spec.ts` (نفس الملف اللي بيمنع الفئة دي
ترجع تحصل بصمت لأي endpoint جديد مستقبلي) — اتأكدت إنها كانت هتفشل قبل الإصلاح (فحصت المنطق يدويًا:
`MFA_REQUIRED_PERMISSIONS` ماكانتش تحتوي القيمة، والـmetadata كانت `undefined`).
Live verification: jest (اختبار metadata بحت، مفيش Postgres/DI مطلوب — نفس منهجية باقي حالات
الملف ده).
Status: FIXED

### BUG-013
Severity: P1 (فلوس حقيقية تفضل عالقة في الدفتر بلا أي مسار استرجاع بعد حذف الحساب)
Flow: Phase 25 (Admin Control Plane) — راجعت `AdminCustomersService.delete()` (§24) بحثًا عن أي
تفاعل مالي مفقود بعد إغلاق فجوته الأصلية (إضافة الـendpoint نفسه) في سيشن سابقة
Symptom: `AdminCustomersService.delete()` (أدمن) و`AuthService.deleteMe()` (العميل/الفني/الشغالة
نفسه) كانا بيسوفت-دِلِيت `User` بلا أي فحص على رصيد `Wallet` — الـ`Wallet` نفسه بيفضل زي ما هو
(مش بيتحذف، مالوش `deleted_at` أصلاً)، فأي مستخدم عنده استرداد/مكافأة ولاء/مكافأة ترشيح/أرباح فني
لسه مصروفة كانت الفلوس تفضل موجودة في الدفتر لكن المستخدم (`is_active=false`، ممنوع login) مبقاش
عنده أي طريقة يوصلها تاني.
Reproduction: عميل/فني عنده `wallets.balance_cents > 0` (أو `pending_balance_cents`/
`reserved_balance_cents`) → `DELETE /auth/me` أو `DELETE /admin/customers/:userId` → نجح بلا أي
تحذير أو رفض → `Wallet` row فضل موجود بنفس الرصيد، `User` بقى `deleted_at` NOT NULL — مفيش أي
endpoint (عميل ولا أدمن) يقدر يوصل للرصيد ده تاني غير تدخّل يدوي مباشر في الداتابيز.
Expected: حذف حساب عنده رصيد محفظة حقيقي لازم يترفض بوضوح لحد ما الرصيد يتصفّر (استرداد/صرف)،
مش ينجح بصمت ويحبس الفلوس.
Actual: الحذف كان بينجح دايمًا بغض النظر عن الرصيد.
Root cause: منطق الحذف اتكتب بالتركيز على تنظيف جلسات الدخول/RBAC بس (نفس نمط
`AdminEmployeesService.delete()` اللي اتنسخ منه)، بلا اعتبار إن العميل/الفني (عكس الموظف) ممكن
يكون عنده رصيد مالي حقيقي مرتبط بحسابه.
Files involved: `apps/api/src/modules/admin/admin-customers.service.ts`,
`apps/api/src/modules/admin/admin.module.ts`, `apps/api/src/modules/auth/auth.service.ts`,
`apps/api/src/modules/auth/auth.module.ts`,
`apps/api/src/modules/admin/admin-customer-delete.spec.ts`,
`apps/api/src/modules/auth/auth-self-service.spec.ts`
Financial/security impact: مباشر — فلوس حقيقية (مش مُخترعة، كانت موجودة أصلاً في الدفتر) بتبقى
غير قابلة للاسترجاع للمستخدم صاحبها، ومحتاجة تدخّل يدوي في الداتابيز لأي حد يحاول يصلحها بعدين.
Fix: `assertNoStrandedWalletBalance()` في `AdminCustomersService` (تحقق قبل الـtransaction، برّه
أي قفل) + فحص مطابق مباشرة في `AuthService.deleteMe()` — لو أي من `balance_cents`/
`pending_balance_cents`/`reserved_balance_cents` أكبر من صفر، الحذف بيترفض `VAL_001` برسالة
واضحة توجّه لاستخدام `wallets.adjust` (الأداة الإدارية الموجودة أصلاً). `Wallet` اتضافت كـ
`TypeOrmModule.forFeature` entity في `AdminModule`/`AuthModule` (بدون استيراد `PaymentsModule`
كامل — نفس نمط `Payout` الموجود في `AdminModule` من قبل، تجنّبًا لأي حلقة dependency).
`AdminEmployeesService.delete()` اتراجعت بالمقارنة ولقيتها مش محتاجة نفس الفحص (الموظفين مالهمش
`WalletOwnerType` أصلاً — لا `customer` ولا `technician` ولا `domestic_worker`).
Regression test: `admin-customer-delete.spec.ts` (حالة جديدة: عميل برصيد 120 جنيه، الحذف يترفض
`VAL_001`، الحساب يفضل نشط) + `auth-self-service.spec.ts` (حالة جديدة: عميل برصيد 50 جنيه، الحذف
يترفض، بعد تصفير الرصيد الحذف ينجح عادي). اتأكدت إنهم كانوا هيفشلوا قبل الإصلاح عبر `git stash`
على `auth.service.ts`/`admin-customers.service.ts` — النتيجة كانت خطأ compile-time (`TS2554:
Expected N arguments, but got N+1`) بدل فشل runtime، لأن الـconstructor نفسه اتغيّر — قبول كدليل
أقوى (نفس الأسلوب اللي اتقبل في BUG-008).
Live verification: jest حي ضد Postgres حقيقي (4 اختبارات جديدة نجحت، 21 اختبار في الملفات
المتأثرة كلها نجحت).
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
