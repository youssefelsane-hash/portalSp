# modules/technician-kpi

محرك الـKPI الشهري للفني + مكافأة الأداء (docs/11 §2 — طلب صريح من المالك، 2026-08-13). جدول:
`technician_kpi_snapshots` (`infra/migrations/0083`).

**الحالة: شغال بالكامل، مختبر حي (E2E حقيقي على بيانات طلبات/تقييمات/شكاوى/محفظة حقيقية).**

## المبدأ الحاكم

**المنصة بتحسب وتعرض بيانات أداء موضوعية بس — الأدمن/العمليات هو اللي بيقرر المبلغ النهائي.**
مفيش قرار آلي نهائي على فلوس حقيقية. كل الأبعاد، الأوزان، العتبات، والحدود قابلة للتعديل من
`settings` (`group_name='kpi'`) — صفر قيم مكتوبة في الكود.

## من أين تيجي كل البيانات — صفر بيانات مخترعة

كل بُعد مبني على جداول موجودة أصلاً، بلا أي جدول تجميع جديد أو تسجيل يدوي إضافي:

| البُعد | المصدر |
|---|---|
| متوسط التقييم | `ratings` (`rating_type='customer_to_technician'`, `is_published=true`), بحساب شهر `created_at` |
| قبول العروض | `order_assignments` (`assignment_status`) — العروض المُستجاب عليها (accepted/rejected/timeout) |
| إتمام الطلبات | `orders.order_status='completed'`, بحساب شهر `work_completed_at` |
| إلغاء الفني | `technician_order_cancellations` — **مش** `orders.order_status='cancelled_by_technician'` (حالة شبه ميتة بعد سياسة إلغاء الفني، `technicians/README.md`) |
| الشكاوى المثبتة | `complaints` (`against_user_id` = مستخدم الفني، `resolution_type != 'no_action'` و`complaint_status IN ('resolved','closed')`) |
| إعادة الزيارة | `orders` بـ`order_type='revisit'` مربوطة بـ`parent_order_id` لطلب أصلي لنفس الفني |
| الإيراد النسبي | `wallet_transactions` (`transaction_type='order_earning'`, `direction='credit'`, `is_reversed=false`) — مقارنة بمتوسط كل الفنيين النشطين الشهر ده (مش رقم مطلق) |

**متعمّد الاستبعاد**: "الوصول في الوقت/التأخير" (مفيش عمود مسجّل فعليًا للفرق بين الموعد المجدول
والوصول الفعلي — `docs/11` طلب البحث الأولي أكّد كده صراحة)، و"إنتاجية مقابل المتوقع" (مبنية على
`service_productivity_actuals` بس تغطيتها جزئية جدًا — خدمات standard_data فقط، وتسجيل نصف يدوي).
الاتنين مؤجّلين عمدًا لحد ما يبقى فيه بيانات كافية — مفيش تقدير تقريبي بيتقدّم كـ"حقيقة".

## الدرجة (0-100 لكل بُعد، ثم متوسط مرجّح)

- كل بُعد بيتحسب **بس لو فيه بيانات كافية الشهر ده** (مثلاً مفيش تقييمات = مفيش بُعد rating أصلاً)
  — الوزن بيتعاد توزيعه تلقائيًا على الأبعاد المتاحة (`overallScore` بيتحسب بقسمة weighted sum على
  `totalWeight` للأبعاد المتاحة بس، مش 100 ثابتة).
- `kpi.serious_complaint_zero_score` (افتراضي `true`): شكوى `severity=critical` مثبتة الشهر ده
  بتصفّر `overall_score` بالكامل تلقائيًا (`serious events force zero KPI`، طلب صريح من المالك).
- الأهلية للمقترح الآلي: `kpi.min_completed_jobs_for_eligibility` (افتراضي 3) — لو أقل، مفيش
  `suggested_bonus_cents` (null)، لكن الأدمن **لسه يقدر يعتمد مبلغ يدوي** لو شاف داعي (تقدير حالة
  استثنائية) — الأهلية بتتحكم في الاقتراح الآلي بس، مش في سلطة القرار البشري.
- `suggested_bonus_cents = round(kpi.monthly_max_bonus_cents * overall_score / 100)`.

## سير الموافقة/الصرف — دايمًا بشري

`calculated → approved → paid` (أو `→ rejected` بدل approved، رجوع لـ`calculated`/`rejected`
ممكن يتراجع عنه بموافقة لاحقة). **الأدمن مش لازم يعتمد الرقم المقترح بالظبط** إلا لو
`kpi.ops_can_override_suggested_amount=false`. السقف الشهري (`kpi.monthly_max_bonus_cents`)
بيتفرض دايمًا إلا لو الأدمن عنده صلاحية `technician_kpi.override_max` (نفس نمط
`roles.grant_unrestricted` من ADR-0010 بالحرف) — و`super_admin` بياخدها أوتوماتيك عن طريق
الـbypass، مفيش منح صريح ليه محتاج.

**immutability حقيقية**: أي سنابشوت وصل `approved`/`paid` بيتقفل تمامًا — إعادة حساب
(`calculateForPeriod`) بترجّع `skippedLocked` بدل ما تلمسه. `rejected` مش قفل نهائي (قرار "مفيش
مكافأة الجولة دي" قابل للمراجعة لاحقًا بموافقة، عكس `approved`/`paid` اللي فيهم فلوس اتحركت أو
اتقفلت فعليًا).

الصرف (`pay`) بيستخدم `WalletsService.doubleEntry()` الموجود (محفظة المنصة → محفظة الفني،
`WalletTxType.BONUS`) — idempotent عبر فحص `status='approved'` قبل الصرف (اتأكد حي: نداءين
متزامنين لنفس الصرف، التاني رجع 409 من غير قيد مالي مكرر).

## اختبار حي كامل (تفاصيل أرقام حقيقية في سجل commit)

- حساب دفعة كاملة لشهر حقيقي على 3 فنيين بأنشطة حقيقية مختلفة (فني بـ34 طلب مكتمل، فني بعرض واحد
  بس، فني بطلب واحد مكتمل) — كل واحد طلع بدرجة/أهلية صحيحة حسب بياناته الفعلية.
- **اختبار سلبي حقيقي**: أدمن بدور `ops_manager` (بلا `technician_kpi.override_max`) حاول يعتمد
  مبلغ فوق السقف الشهري → اترفض 403 بالضبط. نفس الأدمن اعتمد مبلغ داخل السقف بنجاح، صرفه، وقيد
  المحفظة اتأكد منه مباشرة (`wallet_transactions` صف debit من المنصة + صف credit للفني، نفس المبلغ).
  `super_admin` بالمقابل قدر يتخطى السقف (bypass ADR-0010، سلوك متوقّع مش بَقّة).
- إعادة حساب لنفس الشهر بعد الاعتماد/الصرف: السنابشوتات المقفولة اتفضلت زي ما هي (`skippedLocked`
  صحيح)، بس السنابشوت اللي لسه `calculated` اتحسب تاني عادي.
- فني شاف ملخّصه الشخصي (`GET /technician/kpi`) — `approval_notes` ظهرت `null` رغم إن الأدمن كتب
  ملاحظة حقيقية، لأن `kpi.expose_approval_notes_to_technician` افتراضيًا `false` — اتأكد إن نفس
  الحقل بيظهر كامل للأدمن (`GET /admin/technician-kpi/:id`) في نفس اللحظة.
- صلاحيات: `support_agent` (بلا `technician_kpi.calculate`) اترفض 403 بوضوح، عميل حاول يوصل
  لـ`/admin/technician-kpi` اترفض قبل حتى الوصول للـcontroller.
- Playwright حقيقي ضد المتصفح: شاشة القائمة (فلترة شهر/سنة/حالة، إجماليات مقترح/معتمد) وشاشة
  التفاصيل (الأبعاد، البيانات الخام، فورم الاعتماد/الرفض/الصرف) عرضوا بيانات حقيقية صح.

## فجوات موثّقة

مفيش لسه — كل ما طُلب مبني: backend + migration + admin UI (قائمة+تفاصيل+اعتماد/رفض/صرف) +
technician-app UI (ملخّص شهري + سجل) + audit log لكل انتقال + دفتر مالي (double-entry + idempotent)
+ صلاحيات (`technician_kpi.calculate`/`approve`/`override_max`) + اختبار سلبي حي + E2E حي.
البُعدين المؤجّلين (الوصول في الوقت، الإنتاجية مقابل المتوقع) موثّقين أعلاه بسبب الاستبعاد الصريح —
مش سهو.
