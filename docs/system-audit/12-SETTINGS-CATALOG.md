# 12 — كتالوج الإعدادات (Settings Catalog)

> **مُولَّد من جدول `settings` الحيّ في `baytak_main`** — 179 مفتاحًا في 26 مجموعة.
> القيم المعروضة هي القيم الفعلية وقت التدقيق.
>
> مستندات مرتبطة: [00 — خريطة النظام](./00-SYSTEM-MAP.md) ·
> [03 — محرك التسعير](./03-PRICING-ENGINE.md) · [10 — تدفّق الأموال](./10-FINANCE-MONEY-FLOW.md)

---

## 1. إزاي محرك الإعدادات شغّال

كل إعداد صف في `settings` بـ`key` و`value` (JSONB) و`value_type` و`group_name` و`description`
و`is_public`.

### القراءة

`SettingsService.getNumber(key, fallback)` / `getBoolean` / `getString` — **الـfallback إلزامي**
عمدًا. النظام بيشتغل حتى لو الصف اتمسح، والافتراضي مكتوب جنب موضع الاستخدام.

> ⚠️ **قاعدة**: مفيش نقطة قراءة واحدة لنفس المفتاح في أكتر من مكان بافتراضي مختلف. الدرس
> المكلف: `matching.full_day_job_minutes` كان بيتقرا في **14 ملف**، كل واحد بنسخته من
> الافتراضي — تغيير الافتراضي كان لازم يتعمل 14 مرة، وأي واحدة تتنسى تفضل شغّالة برقم مختلف
> **بصمت**. اتقفل بنيويًا بـ`resolveDailyCapacityMinutes()` كنقطة قراءة وحيدة.

### الكتابة والانتشار

`SettingsService.update()` بتبعث `SETTING_UPDATED_EVENT` بـ**`emitAsync`** — يعني **بتنتظر**
المستمعين. ده مقصود: مزوّد بوابة الدفع لازم يكون أعاد التهيئة قبل ما التحديث يرجع ناجحًا.

> ⚠️ لفّ أي مستمع للحدث ده في `void` **بيكسر** السلوك ده. اتلقط حيًا.
> راجع [19 §5](./19-BACKGROUND-JOBS-EVENTS.md).

### `is_public`

| القيمة | المعنى |
|--------|--------|
| `عام` | بيتعرض للعملاء/التطبيقات بلا مصادقة إدارية |
| `داخلي` | إداري فقط |

### الصلاحية

تعديل الإعدادات محتاج `settings.manage`، وهي **ضمن `MFA_REQUIRED_PERMISSIONS`** — أي موظف
عنده الصلاحية دي مُلزَم بتفعيل MFA. راجع [20 §3](./20-SECURITY-PERMISSIONS.md).

---

## 2. المجموعات الأكثر أثرًا

| المجموعة | العدد | بتتحكم في |
|----------|-------|-----------|
| `matching` | 30 | التوزيع، الجولات، الترتيب، السقف اليومي — [04](./04-MATCHING-ENGINE.md) |
| `payments` | 19 | البوابات، المهل، استرداد الـwebhooks — [10](./10-FINANCE-MONEY-FLOW.md) |
| `kpi` | 14 | أوزان تقييم الفني والمكافآت |
| `pricing` | 14 | رسوم الطوارئ، العمولة الافتراضية — [03](./03-PRICING-ENGINE.md) |
| `legal_entity` | 11 | البيانات القانونية المعلنة (مطلوبة لـGoogle Play) |
| `campaigns` | 8 | حواجز مكافحة السبام التسويقي |

---

## 3. ثلاثة فخاخ موثّقة للأدمن

### أ) ~~`orders.auto_cancel_after_minutes`~~ — **اتحذف** (migration 0262)

كان موجودًا بقيمة `20` في المجموعة `limits` و**مفيش كود بيقراه**. قرار مالك صريح: طلب
`searching_technician` **مايتلغيش تلقائيًا خالص** مهما طالت المدة — والكود اتشال وقتها، بس
الصف فضل.

**اتحذف نهائيًا في التدقيق**، مش اتعطّل: إعداد بلا قارئ هو توثيق كاذب مخزَّن في قاعدة
البيانات — الأدمن بيقراه ويستنتج سلوكًا مش موجود، ولو غيّر قيمته يفتكر إنه عمل حاجة وهو ما
عملش، ومفيش أي إشارة تقوله كده.

المهلة الحقيقية الوحيدة الشغّالة: `orders.payment_timeout_minutes` (١٥ دقيقة، للدفع الإلكتروني
اللي بدأ ومخلّصش).

📄 [02 §6](./02-ORDER-LIFECYCLE.md)

### ب) أوزان المطابقة كلها **صفر** حاليًا

`matching.distance_weight` · `fairness_weight` · `reliability_weight` — كلها `0`. يعني الترتيب
فعليًا بيعتمد على **وزن المستوى ناقص الحمل** بس. لو حد بيتوقع تأثير المسافة أو العدالة على
الترتيب، **مش هيلاقيه**.

📄 [04](./04-MATCHING-ENGINE.md)

### ج) مفاتيح Paymob فاضية

`payments.paymob.*` كلها `""` — الكارت مفعّل كإعداد لكن **مش هيشتغل فعليًا**.
راجع `docs/03-external-integrations.md`.

---

## 4. الكتالوج الكامل

مرتّب أبجديًا بالمجموعة ثم المفتاح.

### `assistant_matching` — 3 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `assistant_matching.batch_size` | number | `10` | داخلي | عدد المساعدين المرشّحين اللي بيتبعتلهم عرض في كل بث |
| `assistant_matching.pool_matching_enabled` | boolean | `true` | داخلي | مفتاح إيقاف عام لبث فرص المساعدة لمجمع المساعدين |
| `assistant_matching.response_timeout_seconds` | number | `120` | داخلي | مهلة رد المساعدين على عرض المطابقة بالثانية |

### `campaigns` — 8 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `campaigns.abandoned_intent_delay_minutes` | number | `60` | داخلي | بعد كام دقيقة من "العميل بص على خدمة وما حجزش" يتبعت التذكير. القيمة على الحملة نفسها بتغلب دي لو متحددة. |
| `campaigns.enabled` | boolean | `true` | داخلي | تشغيل/إيقاف محرك الحملات التسويقية بالكامل. إقفالها بيوقّف كل الإعلانات التلقائية فورًا بلا أي أثر على إشعارات الطلبات. |
| `campaigns.inactive_customer_days` | number | `90` | داخلي | العميل اللي ما دخلش من أكتر من كده ما بياخدش إعلانات — حساب ميت، والإرسال ليه بيضر سمعة المُرسِل. |
| `campaigns.max_per_customer_per_week` | number | `2` | داخلي | أقصى عدد إشعارات تسويقية للعميل الواحد في الأسبوع — **فوق كل الحملات مجتمعة**. أهم حاجز ضد السبام: مهما فعّل الأدمن حملات، السقف ده بيحكمهم كلهم. |
| `campaigns.periodic_interval_days` | number | `4` | داخلي | كل كام يوم يتبعت إعلان دوري للعميل الواحد (لو مفيش مانع تاني). |
| `campaigns.quiet_hours_end` | string | `"06:00"` | داخلي | نهاية ساعات الهدوء للإعلانات (UTC). |
| `campaigns.quiet_hours_start` | string | `"21:00"` | داخلي | بداية ساعات الهدوء للإعلانات (UTC) — مفيش إعلان جوّه النطاق ده. أوسع من ساعات هدوء الطلبات عمدًا: الإعلان مالوش أي استعجال. |
| `campaigns.sweep_batch_size` | number | `200` | داخلي | أقصى عدد إشعارات تسويقية في الدورة الواحدة — بيمنع أي دفعة ضخمة مفاجئة. |

### `cancellation` — 5 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `cancellation.auto_rematch_enabled` | boolean | `true` | داخلي | لما فني يلغي طلب مش مختار يدويًا من العميل — نرجّعه فورًا للمطابقة التلقائية (true) ولا نستنى العميل يختار بديل بنفسه (false) |
| `cancellation.min_minutes_before_scheduled_start` | number | `60` | داخلي | أقل عدد دقايق قبل موعد الطلب المجدول (لو موجود) اللي بعده الإلغاء الذاتي بيتمنع |
| `cancellation.team_workers_can_self_cancel` | boolean | `false` | داخلي | هل عضو فريق عادي (worker) يقدر يلغي طلب فريق/شركة بنفسه، ولا لازم يعدّي من المدير/المالك بس |
| `cancellation.technician_self_cancel_enabled` | boolean | `true` | داخلي | هل مسموح للفني يلغي طلب اتقبله بنفسه (تفعيل/تعطيل عام للميزة كلها) |
| `cancellation.window_minutes_after_acceptance` | number | `10` | داخلي | عدد الدقايق المسموحة بعد قبول الفني للطلب اللي يقدر يلغي فيها بنفسه من غير تدخّل الدعم |

### `commission` — 4 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `commission.domestic_worker_percentage` | number | `15` | داخلي | عمولة المنصة من حجوزات الخدمات المنزلية (شغالة/مربية/مقيمة) — قيمة افتراضية تجريبية مش نهائية |
| `commission.emergency_adjustment_percentage` | number | `5` | داخلي | فرق عمولة إضافي (نقاط مئوية) لطلبات "طوارئ" — فوق عمولة الخدمة الأساسية وفرق مستوى الفني، قيمة افتراضية تجريبية مش نهائية |
| `commission.individual_adjustment_percentage` | number | `0` | داخلي | فرق عمولة إضافي (نقاط مئوية) لطلبات "أفراد" — فوق عمولة الخدمة الأساسية وفرق مستوى الفني |
| `commission.team_adjustment_percentage` | number | `0` | داخلي | فرق عمولة إضافي (نقاط مئوية) لطلبات "اعتماد" — فوق عمولة الخدمة الأساسية وفرق مستوى الفني |

### `homepage` — 4 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `homepage.hero_images` | json | `[]` | عام | Ordered homepage hero image URLs (up to 4) shared by customer web and mobile |
| `homepage.search_content` | json | `{"title": "محتاج مساعدة في إيه؟", "eyebrow": "أساعدك…` | عام | Customer homepage search eyebrow, title, description, and input placeholder shared by web and mobile |
| `homepage.tips` | json | `[{"body": "شوف تقييمات الفنيين وعدد الشغلانات اللي خ…` | عام | كروت "نصايح مفيدة" المعروضة أسفل الصفحة الرئيسية (customer-web/customer-app) — عنوان/نص/رابط صورة اختياري لكل كارت، قابلة للتعديل بالكامل من الأدمن |
| `homepage.trust_message` | string | `"ضمان حقيقي على كل شغلانة — لو في أي عيب بعد التسليم…` | عام | رسالة الثقة/الضمان المعروضة في hero الصفحة الرئيسية (customer-web) — قابلة للتعديل بحرية من الأدمن |

### `installments` — 3 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `installments.auto_collection_enabled` | boolean | `true` | داخلي | تشغيل التحصيل التلقائي للأقساط المستحقة بوسائل الدفع المحفوظة — لا يُفعّل إلا بعد التحقق من دعم البوابة للتحصيل المتكرر فعليًا |
| `installments.max_auto_attempts` | number | `3` | داخلي | أقصى عدد محاولات تحصيل تلقائية لكل قسط — بعدها يفضل overdue مرئي للتدخل اليدوي |
| `installments.retry_backoff_days` | number | `3` | داخلي | عدد الأيام بين محاولات إعادة تحصيل القسط الفاشل |

### `kpi` — 14 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `kpi.enabled` | boolean | `true` | داخلي | تفعيل/تعطيل محرك الـKPI الشهري بالكامل |
| `kpi.expose_approval_notes_to_technician` | boolean | `false` | داخلي | إظهار ملاحظات الأدمن الداخلية للفني في شاشة الـKPI بتاعته |
| `kpi.min_completed_jobs_for_eligibility` | number | `3` | داخلي | أقل عدد طلبات مكتملة في الشهر عشان الفني يبقى مؤهّل لمكافأة مقترحة |
| `kpi.monthly_max_bonus_cents` | number | `500000` | داخلي | أقصى مكافأة شهرية للفني الواحد بالقرش (افتراضي 5000 جنيه) — الأدمن العادي مايقدرش يتخطاها |
| `kpi.negative_rating_threshold` | number | `2` | داخلي | التقييم (من 5) اللي يساويه أو أقل منه يُحسب "تقييم سلبي" |
| `kpi.ops_can_override_suggested_amount` | boolean | `true` | داخلي | العمليات تقدر تعتمد مبلغ مختلف عن المقترح (جوّه الحدود) بدل ما تكون ملزمة بالرقم المقترح بالظبط |
| `kpi.penalty_points_per_upheld_complaint` | number | `20` | داخلي | نقاط تُخصم من بُعد الشكاوى لكل شكوى مثبتة (upheld) الشهر ده |
| `kpi.serious_complaint_zero_score` | boolean | `true` | داخلي | شكوى حرجة (critical) مثبتة تصفّر الـKPI الشهري بالكامل تلقائيًا |
| `kpi.weight_acceptance` | number | `15` | داخلي | وزن بُعد معدل قبول عروض الطلبات |
| `kpi.weight_cancellation` | number | `15` | داخلي | وزن بُعد معدل الإلغاء من الفني (سلبي) |
| `kpi.weight_complaints` | number | `15` | داخلي | وزن بُعد الشكاوى المثبتة (سلبي) |
| `kpi.weight_completion` | number | `15` | داخلي | وزن بُعد معدل إتمام الطلبات المقبولة |
| `kpi.weight_rating` | number | `30` | داخلي | وزن بُعد متوسط التقييم |
| `kpi.weight_revenue` | number | `10` | داخلي | وزن بُعد الإيراد النسبي مقارنة بمتوسط الفنيين الشهر ده |

### `legal_entity` — 11 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `legal.commercial_register` | string | `""` | عام | رقم السجل التجاري. |
| `legal.company_name_ar` | string | `"الصانع جروب"` | عام | الاسم القانوني للجهة المشغّلة بالعربي. |
| `legal.company_name_en` | string | `"ELSANE Group"` | عام | الاسم القانوني للجهة المشغّلة بالإنجليزي — بيظهر جنب علامة حقوق النشر ©. |
| `legal.legal_address` | string | `""` | عام | العنوان القانوني المسجَّل للشركة. مطلوب من Google Play قبل النشر. |
| `legal.platform_name_ar` | string | `"أسطى"` | عام | اسم المنصة بالعربي كما يظهر في كل الواجهات والمستندات القانونية. |
| `legal.platform_name_en` | string | `"OSTA"` | عام | اسم المنصة بالإنجليزي. |
| `legal.privacy_email` | string | `""` | عام | بريد طلبات الخصوصية وحقوق أصحاب البيانات (قانون 151 لسنة 2020). لو فاضي بيتعرض بريد الدعم بدله. |
| `legal.support_email` | string | `""` | عام | بريد الدعم الرسمي. مطلوب من Google Play في صفحة السياسة وفي Store Listing. |
| `legal.support_phone` | string | `""` | عام | رقم التواصل الرسمي المعلن. |
| `legal.tax_id` | string | `""` | عام | الرقم الضريبي. |
| `legal.website_url` | string | `""` | عام | الموقع الرسمي للمنصة. لازم يبدأ https:// وإلا بيتجاهَل. |

### `limits` — 7 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `orders.cancellation_free_window_min` | number | `5` | عام | مهلة الإلغاء المجاني بالدقايق |
| `orders.no_show_visit_fee_cents` | number | `5000` | داخلي | رسوم الزيارة الفاشلة (عدم حضور/رفض شغل ضروري) اللي الأدمن بيطبّقها على الطلبات المدفوعة مسبقًا بالقرش |
| `orders.payment_timeout_minutes` | number | `15` | داخلي | إلغاء تلقائي لطلب PENDING_PAYMENT لو الدفع ماتمش |
| `otp.expiry_minutes` | number | `5` | داخلي | صلاحية كود الـ OTP |
| `payouts.auto_approve_limit_cents` | number | `100000` | داخلي | أقصى مبلغ صرف بدون مراجعة بشرية |
| `payouts.min_amount_cents` | number | `20000` | داخلي | أقل مبلغ صرف مسموح |

### `loyalty` — 2 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `loyalty.earn_points_per_100_egp_spent` | number | `1` | داخلي | نقاط الولاء المكتسبة لكل 100 جنيه إنفاق عند اكتمال الطلب |
| `loyalty.point_value_cents` | number | `100` | داخلي | قيمة نقطة الولاء الواحدة بالقرش عند الاستبدال |

### `matching` — 30 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `matching.batch_size` | number | `5` | داخلي | عدد الفنيين في كل دفعة توزيع |
| `matching.broaden_to_busy_after_round` | number | `4` | داخلي | رقم الجولة اللي بعدها يتوسّع البحث لفنيين مرتبطين لكن مشغولين حاليًا |
| `matching.company_large_job_boost` | number | `3` | داخلي | زيادة معتدلة في ترتيب ممثل الشركة المسجلة للشغل الكبير عند كفاية طاقمها (0 = تعطيل) |
| `matching.company_large_job_min_crew` | number | `4` | داخلي | أقل إجمالي أفراد مطلوب في طلب فريق قبل تطبيق أفضلية الشركة المسجلة (افتراضي 4) |
| `matching.daily_capacity_minutes` | number | `720` | داخلي | أقصى دقايق شغل للفني في اليوم الواحد (720 = 12 ساعة). لو المحجوز في اليوم + الشغلانة الجديدة عدّى الرقم ده، الفني مايترشّحش لليوم ده. |
| `matching.distance_weight` | number | `0` | داخلي | وزن المسافة الأساسي في ترتيب المطابقة — كل كيلومتر بيخصم القيمة دي من نتيجة الفني. 0 = المسافة كاسر تعادل بس (افتراضي) |
| `matching.distance_weight_emergency` | number | `0` | داخلي | وزن المسافة لطلبات الطوارئ — القيمة كلها في وقت الوصول، فالقرب بياخد شدّة أعلى. لو أقل من الأساسي، الأساسي بيسري |
| `matching.distance_weight_low_value` | number | `0` | داخلي | وزن المسافة للشغلانات الرخيصة (أقل من أو يساوي matching.low_value_order_cents) — تكلفة الانتقال بتاكل هامش الشغلانة |
| `matching.distance_weight_near_term` | number | `0` | داخلي | وزن المسافة للطلبات خلال نافذة matching.near_term_request_hours (48 ساعة افتراضيًا) — مفيش مساحة لإعادة توزيع، فالأقرب أضمن |
| `matching.fairness_decline_weight` | number | `0.5` | داخلي | وزن الفرصة المرفوضة الحديثة في حساب العدالة، نسبة لوزن الطلب المؤكد الفعلي (0 = الرفض بلا أثر، 1 = زي المؤكد بالظبط) |
| `matching.fairness_lookback_days` | number | `7` | داخلي | نافذة الأيام اللي نموذج العدالة بيراجعها لحساب توزيع الشغل الحديث للفني |
| `matching.fairness_weight` | number | `0` | داخلي | وزن مكوّن العدالة في ترتيب المطابقة — 0 = معطّل تمامًا (الترتيب زي ما هو دلوقتي)، لحد ما يتفعّل صراحة |
| `matching.low_value_order_cents` | number | `15000` | داخلي | حد «الشغلانة الرخيصة» بالقرش (15000 = 150 جنيه) — الطلب تحته بياخد وزن المسافة المخصّص للشغل الرخيص |
| `matching.near_term_request_days` | number | `1` | داخلي | عدد الأيام المستقبلية (من النهاردة) اللي بتفضل طلب/قبول-رفض عادي — بعدها تأكيد تلقائي |
| `matching.near_term_request_hours` | number | `48` | داخلي | الشغل اللي معاده خلال العدد ده من الساعات بيتبعت للفنيين كـ"طلب" محتاج قبول (زي الطوارئ) بدل التعيين التلقائي. 0 = تعطيل (كل غير الطوارئ يتعيّن تلقائي). |
| `matching.near_term_round_timeouts_minutes` | string | `"5,15,30"` | داخلي | مهلة كل موجة بث للشغل القريب بالدقايق، مفصولة بفاصلة — الموجة الأولى 5 دقايق، التانية 15، التالتة 30. أي موجة بعد كده بتاخد آخر قيمة. |
| `matching.offer_heavy_workload_technicians` | boolean | `true` | داخلي | فني تصنيفه HEAVY (شاغل يوم كامل/مدة متعددة الأيام) يتعرضله فرصة اختيارية برضه؟ false = يتستبعد تمامًا زي القديم |
| `matching.preferred_crew_max_size` | number | `10` | داخلي | أقصى عدد أعضاء مقبولين في الفريق المفضّل الدائم لكل فني (docs/08 §36.16) |
| `matching.radius_km_initial` | number | `5` | داخلي | نطاق البحث الأول عن فني بالكيلومتر |
| `matching.radius_km_max` | number | `15` | داخلي | أقصى نطاق بحث |
| `matching.recovery_batch_size` | number | `25` | داخلي | أقصى عدد طلبات يأخذ دوره في جولة استرداد واحدة |
| `matching.recovery_initial_backoff_seconds` | number | `60` | داخلي | مهلة إعادة المحاولة الأولى للطلب الذي لم يجد فنيًا؛ تتضاعف تدريجيًا لمنع حجب الطلبات الجديدة |
| `matching.recovery_interval_seconds` | number | `60` | داخلي | عدد الثواني بين جولات استرداد الطلبات التي ما زالت تبحث عن فني |
| `matching.recovery_max_backoff_seconds` | number | `3600` | داخلي | أقصى مهلة بين محاولات مطابقة الطلب العالق، بالثواني |
| `matching.reliability_baseline_rating` | number | `4.0` | داخلي | خط أساس التقييم المتوقّع — فني فوقه ياخد أولوية إضافية، تحته خصم (نسبة لـreliability_weight) |
| `matching.reliability_min_ratings_count` | number | `3` | داخلي | أقل عدد تقييمات مطلوب قبل ما الموثوقية تأثر على الترتيب — فني تحت العدد ده محايد تمامًا (صفر تأثير سلبي/إيجابي) |
| `matching.reliability_weight` | number | `0` | داخلي | وزن تقييم الفني (average_rating) في ترتيب المطابقة — 0 = معطّل بالكامل (افتراضي) |
| `matching.tie_break_threshold` | number | `0` | داخلي | الفرق بين نتيجتين مرشّحين اللي تحتهم يُعتبروا "متعادلين" لكسر التعادل الموزون عشوائيًا — 0 = معطّل (ترتيب حتمي زي القديم) |
| `matching.work_opportunity_exclusive_seconds` | number | `7200` | داخلي | مدة حصرية العرض الاختياري الأول؛ بعدها يظل العرض صالحًا لكن يمكن توسيعه بالتوازي لفني آخر |
| `matching.workload_balance_weight` | number | `2` | داخلي | وزن يتطرح من أولوية مستوى الفني (order_priority_weight) عن كل طلب نشط عليه حاليًا — عشان التوزيع يبقى متوازن مش دايمًا نفس الفني الأعلى مستوى/الأقرب (0 = تعطيل) |

### `notification_engine` — 9 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `notification_engine.action_required_max_reminders` | number | `24` | داخلي | أقصى عدد تذكيرات لأي action_required قبل ما يفضل ساكت (مش resolved) |
| `notification_engine.action_required_reminder_interval_minutes` | number | `60` | داخلي | كل قد إيه يتكرر تذكير action_required لحد ما يتحل (بالدقايق) |
| `notification_engine.critical_offer_bypasses_quiet_hours` | boolean | `true` | داخلي | هل عروض critical_offer بتتخطى ساعات الهدوء (لسه غير مفعّل الاستخدام في Phase 1) |
| `notification_engine.critical_offer_reminder_ratios` | json | `[0.5, 0.85]` | داخلي | نِسَب مواقع تذكيرات عرض الطوارئ (critical_offer) جوّه نافذة الصلاحية نفسها (0-1، مثلاً 0.5 = نص المهلة) — قابلة للتعديل الكامل، صفر قيم دائمة |
| `notification_engine.quiet_hours_end` | string | `"08:00"` | داخلي | نهاية ساعات الهدوء (UTC، HH:MM) |
| `notification_engine.quiet_hours_start` | string | `"22:00"` | داخلي | بداية ساعات الهدوء (UTC، HH:MM) — تذكيرات action_required بتتأجل لبعدها |
| `notification_engine.scheduled_job_day_before_hour_utc` | number | `8` | داخلي | الساعة (UTC) صبح اليوم اللي قبل الموعد لتذكير scheduled_job — لو الموعد بعيد بما يكفي |
| `notification_engine.scheduled_job_pre_appointment_minutes` | number | `120` | داخلي | قد إيه قبل الموعد نفسه يتبعت آخر تذكير scheduled_job |
| `notification_engine.scheduled_job_reminder_after_minutes` | number | `60` | داخلي | أول تذكير scheduled_job بعد كام دقيقة من القبول لو الفني لسه ما فتحش الإشعار الأول |

### `ops` — 3 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `ops.queue_watchdog_check_interval_minutes` | number | `2` | داخلي | كل قد إيه (بالدقايق) الـwatchdog بيفحص الطوابير |
| `ops.queue_watchdog_enabled` | boolean | `true` | داخلي | تفعيل/تعطيل مراقبة تعليق طوابير BullMQ (matching-rounds/customer-stats/technician-stats) — لو اتعطّل، مفيش exit تلقائي للـprocess حتى لو طابور معلّق |
| `ops.queue_watchdog_stall_threshold_minutes` | number | `5` | داخلي | أقل عدد دقايق تفضل فيها أقدم وظيفة واقفة في الطابور (مع إن Redis نفسه متاح ومتجاوَب) قبل ما نعتبرها Worker معلّق ونعمل exit نظيف للـprocess |

### `orders` — 6 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `crew.optional_assistant_enabled` | boolean | `true` | داخلي | يسمح لفني الشغلانة الفردية إنه يضم مساعد اختياري. الاختياري عمره ما يتحسب "نقص طاقم" — مفيش تصعيد ولا كارت أحمر. |
| `crew.optional_assistant_max_per_order` | number | `1` | داخلي | أقصى عدد مساعدين اختياريين في الشغلانة الفردية الواحدة (طلب المالك: واحد بس). |
| `orders.crew_shortage_escalation_hours_before` | number | `24` | داخلي | قد إيه قبل موعد طلب الفريق (بالساعات) نصعّد للأدمن لو الطاقم لسه ناقص |
| `orders.max_work_sessions_per_order` | number | `3` | داخلي | أقصى عدد زيارات لطلب واحد (استكمال الشغل يوم تاني). بعده لازم تدخّل الدعم. |
| `orders.technician_reschedule_max_requests` | number | `2` | داخلي | أقصى عدد طلبات تأجيل يستطيع الفني إرسالها لنفس الطلب قبل تدخل الدعم |
| `revisit.original_technician_response_hours` | number | `48` | داخلي | مهلة رد الفني الأصلي على إعادة زيارة مثبّتة عليه (بالساعات). بعدها بتظهر عند الأدمن كبند محتاج تصرّف — التحرير قرار أدمن مش تلقائي لأن وراه خصم مالي. |

### `payments` — 19 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `crew.assistant_share_ratio` | number | `0.65` | داخلي | نسبة حصة المساعد من حصة الفني في نفس المستوى داخل الطاقم (0.65 = المساعد بياخد 65% من اللي الفني بياخده). بتتضرب في وزن المستوى، مش بديل عنه. |
| `earnings.v2_cutover_enabled` | boolean | `false` | داخلي | Enable policy version 2 for newly created paid orders only after readiness reaches 100%. |
| `earnings.v2_shadow_enabled` | boolean | `true` | داخلي | Compare legacy and V2 results without posting V2 wallet movements. |
| `payments.card_enabled` | boolean | `true` | داخلي | إظهار الدفع بالبطاقة عبر Paymob للعملاء عند اكتمال الإعداد |
| `payments.cash_enabled` | boolean | `true` | داخلي | تفعيل الدفع كاش (تسليم مباشر للفني) — لو اتعطّل، العميل ميقدرش يأكّد تسليم كاش ولا يختاره كوسيلة دفع جديدة |
| `payments.fawry_enabled` | boolean | `false` | داخلي | تفعيل الدفع بكود فوري المرجعي (Fawry) — معطّل افتراضيًا، مش أولوية V1 (ADR-0013) |
| `payments.installments_enabled` | boolean | `true` | داخلي | إتاحة خطط التقسيط المرتبطة بالخدمات عند جاهزية Paymob |
| `payments.instapay.ipa_address` | string | `""` | داخلي | عنوان IPA أو رقم موبايل InstaPay المسجّل — بيتعرض للعميل كتعليمات تحويل. فاضي = InstaPay معطّلة (isConfigured=false) |
| `payments.instapay.qr_image` | string | `""` | داخلي | صورة QR لاستقبال تحويلات InstaPay — إما "storage://<key>" لملف مرفوع من لوحة الأدمن، أو رابط https خارجي. فاضي = مفيش QR (العميل بيشوف تعليمات التحويل النصية بس) |
| `payments.instapay.recipient_name` | string | `""` | داخلي | الاسم اللي بيتعرض للعميل مع عنوان IPA فوق (يتطمّن إنه بيحوّل للجهة الصح). فاضي = InstaPay معطّلة |
| `payments.instapay_confirmation_window_hours` | number | `24` | داخلي | مدة صلاحية كود تحويل InstaPay قبل ما يتطلب إعادة الدفع من جديد (ساعات) |
| `payments.instapay_enabled` | boolean | `true` | داخلي | إظهار InstaPay للعملاء عند اكتمال بيانات المستلم |
| `payments.wallet_enabled` | boolean | `true` | داخلي | إتاحة الدفع من محفظة العميل |
| `payments.webhook_processing_stale_minutes` | number | `5` | داخلي | بعدها تعتبر محاولة webhook processing عالقة وقابلة للاسترداد |
| `payments.webhook_recovery_base_delay_seconds` | number | `30` | داخلي | أول مهلة لإعادة معالجة webhook فاشل؛ يتضاعف التأخير لكل محاولة |
| `payments.webhook_recovery_batch_size` | number | `25` | داخلي | أقصى عدد webhooks يستعيده الفحص الدوري في الدفعة الواحدة |
| `payments.webhook_recovery_max_attempts` | number | `5` | داخلي | أقصى عدد محاولات معالجة webhook فاشل قبل المراجعة اليدوية |
| `technician_debt.alert_age_days` | number | `14` | داخلي | ADR-0041: عدد أيام استمرار المديونية اللي بعدها تتحسب "قديمة". الحالة alert بتيجي لما العتبتين يتعدّوا مع بعض. |
| `technician_debt.alert_threshold_cents` | number | `50000` | داخلي | ADR-0041: مديونية الفني اللي فوقها تتحسب "تستاهل انتباه". بالقرش (50000 = 500 ج.م.). |

### `payments_paymob` — 7 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `payments.paymob.api_key` | string | `""` | داخلي | Paymob API key (secret, encrypted) |
| `payments.paymob.base_url` | string | `"https://accept.paymob.com"` | داخلي | Paymob API base URL |
| `payments.paymob.hmac_secret` | string | `""` | داخلي | Paymob webhook HMAC secret (secret, encrypted) |
| `payments.paymob.integration_id_card` | string | `""` | داخلي | Paymob card integration ID |
| `payments.paymob.integration_id_mobile_wallet` | string | `""` | داخلي | Optional Paymob mobile-wallet integration ID |
| `payments.paymob.public_key` | string | `""` | داخلي | Paymob Unified Checkout public key |
| `payments.paymob.secret_key` | string | `""` | داخلي | Paymob Intention API secret key (secret, encrypted) |

### `pricing` — 14 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `commission_base.discount_reduces_technician_share` | boolean | `false` | داخلي | false = الخصم (كوبون/عمارة) بيتحمّله نصيب الشركة وحدها، والفني بياخد على سعر الشغل الكامل قبل الخصم. |
| `commission_base.include_additional_items` | boolean | `true` | داخلي | البنود الإضافية المعتمدة أثناء الشغل داخل الوعاء (طلب مالك صريح: "ده برضه بيعتبر ضمن الشغل"). |
| `commission_base.include_addons` | boolean | `true` | داخلي | إضافات الكتالوج المختارة وقت الحجز داخل الوعاء — شغل إضافي حقيقي بينفّذه الفني. |
| `commission_base.include_emergency_surcharge` | boolean | `false` | داخلي | رسوم الطوارئ الإضافية: false = 100% للشركة. |
| `commission_base.include_inspection_fee` | boolean | `true` | داخلي | رسوم المعاينة داخل الوعاء — الفني هو اللي بينزل المعاينة فعلاً. |
| `commission_base.include_installment_interest` | boolean | `false` | داخلي | فوائد/رسوم التقسيط: false = 100% للشركة (طلب مالك صريح). |
| `commission_base.include_level_premium` | boolean | `true` | داخلي | مضاعف مستوى الفني داخل وعاء العمولة — ليفل أعلى يعني فلوس أكتر للفني نفسه (طلب مالك صريح). |
| `commission_base.include_warranty` | boolean | `false` | داخلي | سعر الضمان الاختياري: false = 100% للشركة (طلب مالك صريح — ده كان أصل البلاغ). |
| `commission_base.include_zone_surge` | boolean | `false` | داخلي | مضاعف المنطقة/التضخم: false = الزيادة دي 100% للشركة، الفني مالوش نصيب فيها. |
| `emergency.sla_minutes` | number | `60` | داخلي | الوقت المعلن للعميل ("هيوصلك خلال X دقيقة") لطلبات الطوارئ — رقم معلن بس، مش ETA محسوب من مسار/زحمة فعلية، قيمة افتراضية تجريبية مش نهائية |
| `pricing.auto_match_level_premium` | string | `"charge"` | داخلي | لما المطابقة التلقائية تعيّن فني مستواه بيزوّد السعر: charge = الفرق يتضاف للطلب كسطر "فني مميّز" (السلوك المطلوب من المالك)؛ absorb = الشركة تتحمّله والسعر ما يتغيّرش. |
| `pricing.default_commission_percent` | number | `15` | داخلي | نسبة العمولة الافتراضية |
| `pricing.emergency_surcharge_percentage` | number | `20` | داخلي | رسوم إضافية صريحة (نسبة مئوية) على السعر التقديري لطلبات "طوارئ" — بتتعرض للعميل قبل التأكيد (orders.surge_amount_cents)، قيمة افتراضية تجريبية مش نهائية |
| `warranty.default_days` | number | `14` | عام | مدة الضمان الافتراضية |

### `productivity` — 3 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `productivity.default_evaluation_period_months` | number | `1` | داخلي | عدد الشهور الافتراضي لتجميع بيانات الإنتاجية لو مفيش months مبعوت في الطلب |
| `productivity.enabled` | boolean | `true` | داخلي | تفعيل نظام تسجيل الإنتاجية configurable (docs/08 §14) |
| `productivity.metrics_config` | json | `{"complaint_rate": {"weight": 15, "enabled": true, "…` | داخلي | تفعيل/وزن/اتجاه/حجم عينة أدنى لكل مقياس إنتاجية — قابل للتعديل الكامل من /settings (محرر JSON العام)، صفر قيم دائمة في الكود |

### `productivity_learning` — 2 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `productivity_learning.min_change_percentage` | number | `5` | داخلي | أقل نسبة فرق بين الإنتاجية الحالية والمقترحة عشان نولّد اقتراح (تفادي اقتراحات تافهة) |
| `productivity_learning.min_sample_size` | number | `5` | داخلي | أقل عدد observations قبل ما نولّد اقتراح تحديث إنتاجية |

### `projects` — 3 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `projects.milestone_auto_approve_hours` | number | `72` | داخلي | ساعات الموافقة التلقائية للمرحلة إذا العميل ما ردش |
| `projects.quote_expiry_days` | number | `14` | داخلي | عدد أيام صلاحية عرض السعر قبل ما ينتهي |
| `projects.warranty_holdback_percentage` | number | `5` | داخلي | نسبة الاحتجاز من كل دفعة مرحلة لضمان الضمان |

### `recurring` — 2 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `recurring.materialization_lead_time_hours` | number | `96` | داخلي | عدد الساعات قبل موعد الحجز المتكرر التي يتحول فيها إلى طلب فعلي لبدء المطابقة والدفع مبكرًا |
| `recurring.payment_reminder_hours` | json | `[72, 48, 24]` | داخلي | مواعيد تذكير العميل بالدفع قبل تنفيذ الطلب المتكرر، بالساعات |

### `referral` — 4 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `referral.recovery_batch_size` | number | `25` | داخلي | أقصى عدد إحالات معلقة يفحصها مسار الاسترداد في الدورة الواحدة |
| `referral.required_referrals_per_reward` | number | `10` | داخلي | عدد الترشيحات المكتملة (أول طلب فعلي للمُرشَّح) المطلوبة لاستحقاق مكافأة واحدة |
| `referral.reward_validity_days` | number | `90` | داخلي | عدد أيام صلاحية كود مكافأة الترشيح من تاريخ الإصدار |
| `referral.reward_value_egp` | number | `150` | داخلي | قيمة كود الخصم اللي بيتصدر تلقائياً كمكافأة ترشيح (بالجنيه) — تقريب لساعة خدمة قياسية |

### `referral_qr` — 8 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `referral_qr.bonus_amount_cents` | number | `5000` | داخلي | مكافأة الفني بالقرش لكل طلب مؤهّل (افتراضي 50 جنيه — قابل للتعديل بالكامل) |
| `referral_qr.enabled` | boolean | `true` | داخلي | تفعيل/تعطيل نظام ترشيح QR للفني بالكامل |
| `referral_qr.max_monthly_bonus_cents_per_technician` | number | `0` | داخلي | أقصى مكافآت ترشيح شهرية لكل فني بالقرش (صفر = بلا حد أقصى) |
| `referral_qr.min_minutes_between_bonuses` | number | `0` | داخلي | أقل مدة بالدقايق بين مكافأتين متتاليتين لنفس الفني — منع إساءة استخدام (صفر = معطّل) |
| `referral_qr.min_order_amount_cents` | number | `0` | داخلي | أقل قيمة طلب بالقرش عشان يستحق المكافأة (صفر = بلا حد أدنى) |
| `referral_qr.qualifying_min_order_status` | string | `"completed"` | داخلي | أقل حالة طلب لاستحقاق المكافأة: accepted أو work_completed أو completed |
| `referral_qr.reject_duplicate_device` | boolean | `true` | داخلي | رفض المكافأة لو العميل بيستخدم نفس جهاز الفني أو عميل تاني اتكافأ عليه الفني قبل كده |
| `referral_qr.reward_mode` | string | `"first_order_only"` | داخلي | first_order_only = أول طلب مؤهّل بس، every_order = كل طلب مؤهّل |

### `reviews` — 2 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `reviews.google_review_url` | string | `""` | داخلي | رابط صفحة تقييم Google الحقيقي (Google Business Profile) — فاضي = الاقتراح متوقف تلقائيًا لحد ما يتحط |
| `reviews.min_rating_for_google_prompt` | number | `4` | داخلي | أقل overall_rating (من 5) عشان نقترح على العميل يقيّم على Google كمان |

### `social` — 1 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `social.facebook_graph_access_token` | string | `""` | داخلي | مفتاح Facebook Graph API لجلب معاينات لينكات انستجرام/فيسبوك (oEmbed) |

### `support` — 5 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `support.email` | string | `""` | عام | إيميل الدعم (اختياري) |
| `support.enabled` | boolean | `false` | عام | إظهار قسم "تواصل معنا" في التطبيقات — false لحد ما الأرقام تتملى |
| `support.help_url` | string | `""` | عام | رابط صفحة مساعدة/موقع (اختياري، لازم يبدأ https://) |
| `support.phone_number` | string | `""` | عام | رقم تليفون خدمة العملاء (بصيغة دولية، مثال: +201001234567) |
| `support.whatsapp_number` | string | `""` | عام | رقم واتساب خدمة العملاء (أرقام بس، بصيغة دولية بلا +، مثال: 201001234567) |

### `technicians` — 1 مفتاح

| المفتاح | النوع | القيمة | الرؤية | الوصف |
|---|---|---|---|---|
| `technicians.require_national_id_for_approval` | boolean | `true` | داخلي | لازم يكون للفني رقم قومي مسجّل قبل ما الأدمن يقدر يعتمده (approved). إقفالها بيسمح باعتماد فني بلا هوية دائمة — استخدمها لحالات استثنائية بس. |

---

## 5. تحديث هذا الكتالوج

المستند ده **مُولَّد** — عشان تجدّده بعد أي تغيير:

```bash
export PGPASSWORD=baytak
psql -U baytak -h localhost -d baytak_main -At -F$'\t' -c "
  select group_name, key, value_type, value::text,
         case when is_public then 'عام' else 'داخلي' end,
         coalesce(description,'')
  from settings order by group_name, key"
```

**ما تحرّرش الجداول بالإيد** — أي تعديل يدوي هيضيع مع أول تجديد، والأسوأ إنه هيخلّي المستند
يدّعي حالة مش الحالة الفعلية.
