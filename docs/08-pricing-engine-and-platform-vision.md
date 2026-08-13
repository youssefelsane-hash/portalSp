# 08 — محرك التسعير الديناميكي + رؤية المنصة الكاملة (ملف تتبّع حي)

**تاريخ الإنشاء**: 2026-08-11. **مصدر المحتوى**: طلب صريح من المالك (نص وصوت + فيديو مرجعي عن نظام تسعير شركات تشطيب حقيقية) — راجع سجل المحادثة لو محتاج الصياغة الأصلية بالحرف.

## ⭐ قبل ما تلمس أي كود من الملف ده

اقرأ القسم "المبدأ الحاكم" في `CLAUDE.md` الأول. خلاصته هنا كمان لأهميته: **الشغل على المشروع ده لازم يتم دايمًا باحترافية — أبداً بسرعة أو بكروتة.** كل جزء من الملف ده له حالة (✅ خلص / 🔄 قيد التنفيذ / ⬜ فاضي) — **دوّر على الحالة قبل ما تبدأ أي جزء**، ولو لقيته ✅ اعتبره خلص وانتقل لللي بعده، ما تعيدش بناء حاجة موجودة. لو خدت جزء 🔄، حدّث حالته فورًا (مع اسمك/فرعك وتاريخ اليوم) بنفس أسلوب `docs/07-multi-agent-task-split.md` بالظبط — نفس قواعد التنسيق بين السيشنز/الأكاونتات المذكورة هناك تسري هنا حرفيًا.

**كل قرار معماري كبير هنا (schema جوهري، حدود موديول جديد) يتكتب كـ ADR في `docs/adr/` قبل التنفيذ** — أول واحد مطلوب فورًا هو محرك التسعير (§1)، راجع `docs/adr/README.md` للقالب.

---

## ترتيب الأولوية (زي ما المالك حدده صراحة)

1. **محرك التسعير الديناميكي (Pricing Engine)** — "أهم حاجة"، أساس كل حاجة تانية (المدة/الطاقم/الجدولة كلهم محتاجين السعر يتحسب صح الأول). **✅ Phase 1 backend خلص واتعمله اختبار حي كامل** — تفاصيل §1، `apps/api/src/modules/pricing/README.md`.
2. **Scheduler حقيقي للفني** (calendar بدل on/off بسيط). **✅ خلص واتعمله اختبار حي كامل (بما فيه اختبار سباق حقيقي على الداتابيز)** — تفاصيل §2، `apps/api/src/modules/technicians/README.md`.
3. **اختيار الفني قبل الحجز** (بحث/فلتر/مقارنة، مش auto-match بس). **✅ خلص واتعمله اختبار حي** — تفاصيل §3، `apps/api/src/modules/catalog/README.md`.
4. صفحة الفني العامة (تحسينات)
5. فرق العمل (Teams)
6. المساعد (تحسينات فوق Part D الموجود)
7. الضمان وإعادة الزيارة
8. الطوارئ (رسوم/SLA/أولويات)
9. تقييم متقدم
10. تتبع الفني اللحظي — **✅ موجود بالفعل من قبل** (`order-tracking.gateway.ts` + `apps/customer-app/lib/features/tracking/`)، راجعه بس ما تعيدش بناءه
11. الجدولة المستقبلية/المتكررة
12. قطاع الخدمات المنزلية (شغالة/babysitter/مقيمة بالشهور) — نطاق منتج جديد كامل، بعد ما الأساسيات فوق تخلص
13. نظام العمائر (QR + اشتراك خصم) — نطاق منتج جديد كامل، بعد ما الأساسيات فوق تخلص
14. **ترقية أمان دخول الأدمن (Passkeys/WebAuthn + MFA + Step-up)** — طلب صريح جديد من المالك (2026-08-13)، تفاصيل §14 الجديد تحت. **⬜ فاضي بالكامل.**
15. **محرك إشعارات حقيقي (أولوية/تكرار/reminders مُدارة من الباك-إند)** — طلب صريح جديد من المالك (2026-08-13)، تفاصيل §15 الجديد تحت. **🔄 Phase 1 خلص (الأساس العام + action_required)، الباقي فاضي.**

---

## §1. محرك التسعير الديناميكي (Pricing Engine) — ✅ Phase 1 backend خلص (2026-08-11، فرع `hgotr7`)، Phase 2 (واجهة الأدمن البصرية) لسه فاضية

### 1.1 المشكلة اللي بيحلها

دلوقتي كل خدمة سعرها **رقم ثابت واحد** (`services.base_price_cents`) + مضاعفات بسيطة (منطقة/مستوى فني). ده مناسب لخدمات بسيطة (تركيب نجفة مثلاً) لكن **مش كافي خالص** لخدمات زي المحارة/السباكة/الكهرباء اللي سعرها بيتوقف على متغيرات كتير جدًا (المساحة، السمك، الدور، المحافظة، نوع التنفيذ...) وبتختلف جذريًا من صنعة لصنعة. المالك شافها في فيديو مرجعي عن شركة تشطيب حقيقية وطلب صراحة: **"الأدمن وهو بيضيف حرفة جديدة يبقى قدامه خيارات كتير جدًا، وهو اللي يحدد إيه اللي يتحسب وإزاي — من غير أي تعديل كود أو deploy."**

### 1.2 القرار المعماري (المبدأ العام)

- **كل حاجة تتخزن في الداتابيز، مفيش أي رقم/معادلة hardcoded في الكود.** لو الأسعار اتغيرت بكرة، الأدمن يعدّل من اللوحة بس.
- **المعادلة نفسها structured JSON (AST)، مش كود قابل للتنفيذ.** ممنوع تمامًا استخدام `eval()` أو أي تفسير لنص حر كجافاسكريبت/SQL — ده ثغرة أمان مباشرة (remote code execution) لو أدمن خبيث أو حساب مخترق قدر يكتب معادلة. المعادلة بتترسم كشجرة عمليات (operator tree) بيقرأها evaluator آمن بيعرف يفهم بس أنواع عمليات محدودة سلفًا (+ - × ÷ % min max round، مقارنات، IF/ELSE، مرجع لحقل، مرجع لثابت، مرجع لـ lookup table).
- **نفس فلسفة `service_standard_data`/`service_zone_pricing` الموجودين من قبل (تسعير بتاريخ سريان، migration جديدة بس مش تكرار)** — المحرك ده بيبني فوق `services.pricing_model` الموجود (`fixed | hourly | per_unit | inspection_then_quote`) مش بيستبدله: بيضاف قيمة جديدة `formula` للـ enum ده، وأي خدمة `pricing_model=formula` بتفعّل نظام الحقول الديناميكية + المعادلة بدل السعر الثابت.
- **العلاقة بـ `service_standard_data` (بُنيت في الجزء ج من `docs/07`)**: ده كان أول نسخة مبسّطة من نفس الفكرة (يومية صنايعي/مساعد + إنتاجية ثابتة لكل خدمة، بدون حقول ديناميكية أو معادلات شرطية). محرك التسعير ده **يعمم** الفكرة، مش يلغيها — `service_standard_data` تفضل موجودة كمصدر أرقام (يومية/إنتاجية) ممكن المعادلة الجديدة **ترجع لها** بدل ما تكرر الأرقام، خصوصًا لأن محرك التعلّم الذاتي (`service_productivity_actuals`) مبني عليها بالفعل.

### 1.3 نموذج البيانات (Data Model)

**جدول `service_pricing_fields`** (الحقول اللي العميل هيدخلها لكل خدمة `pricing_model=formula`):
- `id`, `service_id` (FK), `field_key` (اسم برمجي فريد داخل الخدمة، زي `wall_thickness_cm`)، `label_ar`، `field_type` (enum — راجع §1.4)، `is_required`، `display_order`، `unit_ar` (وحدة القياس المعروضة، "م²"/"متر طولي"/"نقطة"...)، `options` (JSON — لقيم dropdown/multi-select)، `min_value`/`max_value` (للأرقام/الـ slider)، `is_active`.

**جدول `service_pricing_rules`** (قواعد التسعير — Lookup Tables + Constants + Formula):
- `id`, `service_id` (FK)، `rule_type` (enum: `constant` | `lookup_table` | `formula`)، `rule_key` (اسم مرجعي، زي `price_per_meter` أو `floor_surcharge`)، `payload` (JSON — الشكل بيختلف حسب `rule_type`: ثابت رقم واحد، أو جدول قيم `{field_value: number}`، أو شجرة العمليات للمعادلة)، `display_order`، `valid_from`/`valid_until` (نفس فلسفة `service_zone_pricing` — تسعير بتاريخ سريان، الطلبات القديمة بتفضل بأسعارها).
- **معادلة السعر النهائية نفسها** صف واحد بـ `rule_type=formula`, `rule_key='final_price'` — شجرة عمليات بترجع في الآخر: `price_cents`, `estimated_duration_days` (اختياري)، `required_technicians`/`required_assistants` (اختياري)، `requires_assistant` (bool)، `suitable_for_emergency` (bool).

**جدول `service_pricing_evaluations`** (سجل كل عملية حساب فعلية — للتدقيق والمراجعة، مش للعرض):
- `id`, `service_id`, `order_id` (nullable — لو الحساب اتعمل قبل ما الطلب يتأكد)، `field_values` (JSON — القيم اللي العميل دخلها)، `computed_price_cents`, `computed_duration_days`, `computed_crew`, `evaluated_at`.

### 1.4 أنواع الحقول المدعومة (`field_type`)

`number` | `dropdown` | `multi_select` | `checkbox` | `slider` | `area` (م²) | `length` (متر طولي) | `volume` (م³) | `date` | `time` | `location` | `image_upload` | `video_upload` | `voice_note`

كل نوع بيتخزن بنفس الشكل (`field_type` + `options` JSON لو محتاج قيم محددة) — مفيش جدول منفصل لكل نوع، عشان إضافة نوع جديد مستقبلاً تبقى تعديل enum بس مش migration جديدة كل مرة.

### 1.5 محرك التقييم (Evaluator) — الجزء الأهم أمنيًا

`PricingEngineService.evaluate(serviceId, fieldValues)`:
1. يجيب كل `service_pricing_fields` النشطة للخدمة، يتأكد كل حقل مطلوب (`is_required`) موجود في `fieldValues` وقيمته ضمن `min_value`/`max_value`/`options` المسموحة — رفض واضح (`VAL_001`) لو لأ.
2. يجيب كل `service_pricing_rules` السارية (`valid_from <= now < valid_until`) للخدمة.
3. يقيّم شجرة `final_price` بـ **evaluator محدود** (recursive tree walker) بيعرف يفهم بس: مرجع حقل (`field_ref`)، مرجع ثابت (`constant_ref`)، مرجع lookup (`lookup_ref` — بياخد قيمة حقل ويرجع القيمة المقابلة من الجدول)، عمليات حسابية (`add`/`subtract`/`multiply`/`divide`/`percentage`/`min`/`max`/`round`)، شرط (`if` بمقارنة `equals`/`gt`/`lt`/`gte`/`lte`). **أي عملية برّه القايمة دي = رفض عند الحفظ من الأدمن، مش وقت التنفيذ.**
4. يرجع `{ price_cents, min_price_cents?, max_price_cents?, estimated_duration_days?, required_technicians?, required_assistants?, requires_assistant?, suitable_for_emergency? }`.
5. لو `pricing_model` مش `formula`، يرجع فورًا للمسار القديم (`estimate()` الموجود في `catalog.service.ts`) — **المحرك الجديد إضافة مش استبدال**، خدمات `fixed`/`hourly`/`per_unit`/`inspection_then_quote` تفضل شغالة زي ما هي بالظبط.

### 1.6 نوع التسعير لكل خدمة (`pricing_model` — امتداد للـ enum الموجود)

| القيمة | المعنى | مثال |
|---|---|---|
| `fixed` (موجود) | سعر ثابت | تركيب نجفة |
| `hourly` (موجود) | بالساعة | تنظيف سريع |
| `per_unit` (موجود) | بالوحدة | نقطة كهرباء |
| `inspection_then_quote` (موجود) | معاينة ثم عرض سعر | تشطيب فيلا كامل |
| **`formula` (جديد)** | معادلة ديناميكية كاملة | محارة، سباكة، كهرباء |

### 1.7 لوحة الأدمن (Builder) — على مرحلتين، مش دفعة واحدة

- **مرحلة 1 (backend + API فقط، تبدأ الأولى)**: CRUD كامل على `service_pricing_fields`/`service_pricing_rules` عبر REST عادي (JSON body، بدون واجهة سحب وإفلات). ده كافي يخلي المحرك شغال ومختبر حي بالكامل، والأدمن يقدر يستخدمه عبر `curl`/Postman لحد ما الواجهة الرسمية تتبني.
- **مرحلة 2 (apps/admin UI — بعد ما الـ backend يثبت)**: واجهة "Builder" شبه Excel — إضافة حقل بالسحب، بناء المعادلة بـ blocks، **Preview** بيدي الأدمن يجرب قيم تجريبية ويشوف الناتج قبل الحفظ (زي ما المالك طلب صراحة — "يجرب 10 حالات ويشوف السعر الناتج"). ده شغل frontend كبير مستقل، يتاخد كجزء منفصل بعد ما الـ backend يخلص ويتثبت.

### 1.8 أمثلة مرجعية (من الرؤية، مش أرقام نهائية معتمدة)

المالك نفسه أكّد إن أرقام الفيديو **مش نهائية** (بتختلف حسب المنطقة/سمك التنفيذ/كثافة الشغل) — الأمثلة هنا للتوضيح المعماري بس، **ممنوع اعتمادها كأرقام حقيقية بدون تأكيد صريح من الأدمن وقت الإدخال الفعلي** (نفس مبدأ `service_standard_data` الموجود أصلاً — الجداول بتتسيب فاضية لحد ما تتأكد).

**محارة**: حقول (`نوع المحارة` dropdown: داخلي/خارجي/سقف، `المساحة` area، `السمك` dropdown: 2/2.5/3 سم، `فيه تلييش؟` checkbox، `الدور` number، `المحافظة` dropdown). قواعد: lookup لسعر المتر حسب النوع، معادلة `IF سمك=3 THEN +15%`, `IF تلييش THEN +12×مساحة`, `IF دور>5 THEN +8%`, lookup لمضاعف المحافظة، `Final = MAX(Base, الحد_الأدنى)`.

**سباكة**: حقول (`عدد الحمامات`, `عدد المطابخ`, `تشطيب أم تأسيس` dropdown, `نوع المواسير` dropdown, `الدور` number, `فيه تكسير؟` checkbox). قواعد: `تأسيس حمام × عدد الحمامات`, `تأسيس مطبخ × عدد المطابخ`, `IF تكسير THEN +ثابت`, `IF مواسير=PPR THEN +15%`.

---

## §2. Scheduler حقيقي للفني — ✅ خلص بالكامل (2026-08-11 العرض/الإدارة، 2026-08-12 التكامل الكامل مع إنشاء الطلب)

**الوضع الحالي**: `technician_profiles.is_available`/`is_on_duty` — مفتاحين on/off بس، مفيش تاريخ/وقت مرتبط بيهم خالص. مفيش جدول أسبوعي/شهري.

**المطلوب**: جدول جديد `technician_schedule_slots` (أو مشابه) — الفني بيحدد فترات فاضي فيها (يوم + وقت بداية/نهاية، أو نمط متكرر أسبوعي)، تُعرض للعميل كـ"أخضر" (فاضي) أو "أحمر" (محجوز/مش متاح). لما العميل يحجز على سلوت أخضر، يتحول فورًا لمحجوز (أحمر) لباقي الناس. يشمل: ساعات العمل الافتراضية، الإجازات (استثناءات)، حد أقصى لعدد الطلبات في اليوم. **محتاج تصميم schema دقيق قبل التنفيذ (ADR منفصل)** — القرار الأهم: هل السلوتات صفوف منفصلة لكل فترة، ولا نمط تكراري (RRULE-style) + استثناءات؟ الميل المبدئي: صفوف منفصلة (أبسط في الاستعلام والحجز الذرّي، أهم من مرونة التكرار في المرحلة الأولى).

---

## §3. اختيار الفني قبل الحجز (بحث/فلتر/مقارنة) — ✅ خلص (2026-08-12، فرع `hgotr7`)

**الوضع الحالي**: مفيش endpoint بيرجّع "قايمة فنيين للخدمة دي" خالص. العميل إما auto-match تلقائي بالكامل، أو (في وضع "اعتماد" بس) يختار **شركة** مش فرد.

**المطلوب**: `GET /services/:id/technicians` (public، بدون تسجيل دخول أدمن) — قايمة فنيين مؤهلين للخدمة دي في منطقة العميل، مرتبة بـ: التقييم (`average_rating`) → القرب الجغرافي (PostGIS، من عنوان العميل) → عدد النقاط/الطلبات المكتملة. كل صف: اسم، صورة، تقييم، عدد طلبات، بايو مختصر. العميل يدوس على فني → يشوف بروفايله الكامل (§4) + (بعد ما §2 يخلص) السلوتات الفاضية بتاعته → يحجز في سلوت محدد.

**إضافة (2026-08-13، قرار عمل صريح من المالك)**: مضاعف سعر مستوى الفني (`ServiceLevelPricing.priceMultiplier`, موجود من قبل) كان محسوب في `CatalogService.estimate()` بس **مش موصّل لأي حاجة العميل بيشوفها قبل التأكيد** — العميل كان بيختار فني من §3 من غير ما يعرف السعر النهائي هيبقى قد ايه لو الفني ده رتبته Gold/Platinum. اتقفلت الفجوة: `GET /services/:id/technicians` دلوقتي بيرجّع لكل فني مرشّح `technician_level` + `final_price_cents` (= `estimate.estimated_total_cents + inspection_fee_cents + emergency_surcharge_cents`, بيشمل رسوم الطوارئ لو `is_emergency=true`) + `level_price_multiplier` محسوبين فعليًا بنفس محرك `CatalogService.estimate()` (بدون تكرار حساب). لخدمات `pricing_model=formula` السعر مش بيتحسب لكل مرشّح (محتاج `field_values` من العميل مش متوفرة وقت القايمة) فـ`final_price_cents=null` — سلوك متعمّد، مش نقص.

`POST /orders/preview` و`POST /orders` (`orders.service.ts`) اتعدّلوا كمان يستحضروا مستوى الفني الفعلي (من `requested_technician_id` أو من الفني المرتبط بسلوت الجدولة المختار) **قبل** ما ينادوا `estimate()`، فالسعر المعروض في المعاينة = السعر الفعلي وقت إنشاء الطلب بالظبط (مفيش مفاجأة سعر بعد التأكيد). `PreviewOrderResponseDto` رجّع `level_price_multiplier` جديد. **مختبر حي**: فني `premium` (مضاعف 1.20) على خدمة أساسها 1000 ج.م. → `final_price_cents` في القايمة، `/orders/preview`، وطلب فعلي بعد التأكيد الثلاثة طابقوا بالظبط (120000 قرش). **لسه محتاج تأكيد حي**: مسار اختيار الفني عبر سلوت جدولة (بدل `requested_technician_id` مباشرة) اتبنى بنفس المنطق بس ماتاختبرش حي في الجلسة دي؛ ورسوم الطوارئ (`emergency_surcharge_cents`) داخل `final_price_cents` اتبنت بس ماتاختبرتش حي بطلب emergency فعلي.

---

## §4. صفحة الفني العامة — تحسينات — ✅ خلص

**موجود بالفعل**: `GET /technicians/:id/profile` بيرجّع اسم/صورة/بايو/سنين خبرة/تقييم/عدد طلبات مكتملة/معدل إلغاء/مناطق عمل/خدمات/آخر 5 تقييمات/`portfolio_links` (لينكات سوشيال ميديا).

**اتقفل**: شهادات/كورسات تدريبية (جدول جديد `technician_certificates`, migration `0059`، مراجعة أدمن قبل الظهور)، `avg_arrival_minutes`/`avg_completion_minutes` (حساب جديد من `orders.technician_departed_at/technician_arrived_at/work_started_at/work_completed_at` مباشرة — مش محتاج `order_status_history`، الأعمدة موجودة على `orders` نفسها). `on_time_rate` اتراجع وتأكد إنه **مش بَقّة** — بيرجّع `null` لسبب سليم (مفيش طلبات مجدولة `scheduled_at` اتنفّذت لسه)، مش خطأ منطق. تفاصيل كاملة + دليل الاختبار الحي في `apps/api/src/modules/technicians/README.md` (قسم "بروفايل الفني العام — تحسينات").

**نطاق متعمّد لسه برّه**: معرض صور أوسع (بخلاف لينكات السوشيال ميديا الموجودة) — لينكات السوشيال ميديا بتغطي الاحتياج الأساسي دلوقتي، هيتراجع لو المالك طلب صراحة معرض صور مرفوعة مباشرة.

---

## §5. فرق العمل (Teams) — 🔄 توزيع الأدوار خلص، الإنتاجية المجمّعة اتأجلت عمداً

**موجود بالفعل**: `technician_companies` (فريق أو شركة، الفرق بينهم `commercial_registration_number` بس)، `team_role` (`independent`/`team_leader`/`team_member`) على `technician_profiles`، `technician_company_branches`.

**اتقفل**: توزيع أدوار أوضح داخل الفريق — `order_team_members` (migration `0060`) جديد، إضافي فوق `orders.technician_id` (لسه "قائد الطلب"). قائد الطلب بيضيف أعضاء من نفس شركته بدور نصي حر لكل طلب `booking_mode='team'`. تفاصيل كاملة + دليل الاختبار الحي في `apps/api/src/modules/orders/README.md`.

**اتقفل (2026-08-13، قرار عمل صريح من المالك)**: مقياس "إنتاجية الفريق" — الأدمن بيحدد الإنتاجية الفعلية للسوق لكل خدمة عبر `ServiceStandardData` الموجود من قبل (`productivityPerDay`, `minTechnicians`, `minAssistants` — كله عبر `POST/GET /admin/services/:id/standard-data` الموجود من زمان)، والنظام **مايخترعش** رقم إنتاجية؛ بياخد كمية العميل الفعلية (`requested_units`) ويحسب الفريق والمدة عبر `CatalogService.estimateDuration()` اللي كانت موجودة ومختبرة بمعزل بس **مش متوصّلة لأي مكان حقيقي في تدفق الحجز**. اتقفلت الفجوة دي فقط (الحساب نفسه كان جاهز 100%، مافيش محرك جديد اتبنى):
- Migration `0074_order_team_productivity.sql`: `orders.standard_data_id`/`required_technicians`/`required_assistants`/`estimated_duration_days` (كلهم NULL لو الطلب ملوش بيانات قياسية — مش كل خدمة عندها `ServiceStandardData`).
- `POST /orders` بياخد `standard_data_id`+`requested_units` اختياريين، لو اتبعتوا يتحسب `estimateDuration()` ويتخزّن على الطلب وقت الإنشاء (snapshot، زي أي سعر تاني — تغيير الإنتاجية بعدين مايأثرش على طلبات قايمة بالفعل).
- **مختبر حي بمثال المالك بالظبط**: إنتاجية مُعرّفة = 30 م²/يوم، فني 1 + مساعد 1. عميل طلب 120 م² → النتيجة: `required_technicians=1`, `required_assistants=1`, `estimated_duration_days=4` — مطابق 100% للمثال في الطلب الأصلي.
- معروض في `apps/admin` (صفحة تفاصيل الطلب، نفس كارت "الإنتاجية والمدة المتوقعة" الموجود من Part B) و`apps/customer-app` (`order_detail_screen.dart`، كارت جديد يظهر لما البيانات موجودة).
- تفاصيل كاملة + دليل الاختبار الحي في `apps/api/src/modules/orders/README.md`.

---

## §6. المساعد (Assistant) — ✅ خلص بالكامل (بناء 2026-08-13، ADR-0007)

راجع `apps/api/src/modules/technicians/README.md` — طلب مساعد/موافقة إدارة/إزالة كلهم شغالين. **كانت فجوة متبقية موثّقة صراحة من زمان**: auto-matching تلقائي لمساعدين متاحين ("النظام يشوف مين متاح ويربطهم") — مؤجلة لأن مفهوم "مساعد متاح للربط" ماكانش موجود في القاموس، مش هيتخترع من غير تأكيد.

**اتقفلت (2026-08-13، قرار عمل صريح من المالك)**: موديول جديد بالكامل `apps/api/src/modules/assistant-matching/` (تصميم كامل + بدائل اتقيّمت في `docs/adr/0007-assistant-pool-matching.md`، قبل أي تنفيذ). أولوية 1: المساعد الشخصي المعتمد للفني القائد (`TechnicianAssistantLinkStatus.approved` الموجود من قبل) لو متاح وملوش تعارض → يتاخد مباشرة بلا بث. أولوية 2: لو مفيش، بث تنافسي لمجمع المساعدين المؤهلين (جدول جديد `order_assistant_offers`، migration `0075`) — أول قبول صحيح ياخد الشريحة، ذرّي بالكامل (قفل `pessimistic_write` على صف الطلب، نفس نمط `MatchingService.accept()`). بمجرد اكتمال العدد المطلوب، كل العروض المعلّقة التانية تتقفل فورًا (`slot_filled`) وjob المهلة يتلغي. لو المهلة عدّت وفيه شرائح فاضية → تصعيد لدور `ops_manager` عبر `NotificationRoutingService.routeToRole()` الموجودة (نفس آلية إشعار الطوارئ). عدد المساعدين المطلوب بييجي من `orders.required_assistants` (§1/`ServiceStandardData` — قرار المالك السابق نفس اليوم) — لو صفر/`null`، آلية المطابقة دي مابتبدأش خالص.

**اتأكد حي بالكامل الأربع سيناريوهات المطلوبة بالحرف**: (1) أولوية 1 — فني له مساعد شخصي معتمد ومتاح → اتعيّن فورًا بلا بث، صفر عروض. (2) أولوية 2 — نفس الفني بس مساعده مش متاح → بث حقيقي لفنيين مؤهلين جداد (تسجيل حقيقي عبر `/auth/register`، مش بيانات SQL خام). (3) سباق قبول متزامن حقيقي (خلفيتين فعليتين بالتوازي، مش تسلسلي) بين مساعدين على نفس الطلب — فايز واحد بس (`201`)، التاني `409` واضح، الخاسر `slot_filled` مش `rejected` (تمييز الحالة صح). (4) تصعيد عند انتهاء المهلة — مهلة اتقلّلت مؤقتًا لاختبارها فعليًا، إشعار وصل لـ`ops_manager` برقم الشرائح الناقصة الدقيق. تفاصيل الأرقام والاستعلامات الكاملة في `apps/api/src/modules/assistant-matching/README.md`.

**تحديث (2026-08-13) — جزء من فجوات النطاق المؤجَّل اتقفل**: ~~حل يدوي إداري بعد التصعيد~~ اتقفلت (ADR-0008 — `POST /admin/orders/:id/assistants` + واجهة أدمن جديدة)، و~~فحص تعارض جدولة صريح للمساعد~~ اتقفلت كمان (نفس شرط `technician_schedule_slots` overlap المضاف لمطابقة الفني القائد، مطبّق دلوقتي على المساعد في الأولويتين). **لسه مؤجّل صراحة**: إعادة بث فوري عند رفض قبل انتهاء المهلة — قرار مبسّط مقصود، موثّق في ADR-0007 نفسه. واجهة `apps/technician-app` (شاشة "فرص المساعدة" قبول/رفض) اتبنت ومتوصّلة من قبل.

---

## §7. الضمان وإعادة الزيارة (Warranty + Revisit) — ✅ خلص

**موجود بالفعل**: `services.warranty_days` (عدد، قابل للتعديل من الأدمن)، وبعد المراجعة لقيت `orders.warranty_expires_at` و`orders.parent_order_id` **موجودين من migration 0007 الأولى برضه** — أعمدة راكدة تانية، مفيش أي إنفاذ فعلي قبل كده.

**اتقفل**: `warranty_expires_at` بيتحسب فعليًا وقت الاكتمال (`PaymentsService.settleAndComplete`) = تاريخ الاكتمال + `warranty_days`. "إعادة زيارة" (`order_type=revisit`, `POST /orders` بـ`original_order_id`) — نفس الخدمة/العنوان، تحت الضمان لسه، بتفرض نفس الفني الأصلي (تفضيل)، **مجانية بالكامل**. بَقّة حقيقية اتلقطت وقت الاختبار الحي (`WalletsService.doubleEntry` بترفض مبلغ صفر، فطلب مجاني بالكامل كان بيعلق في `work_completed` للأبد) واتصلحت. تفاصيل كاملة + دليل الاختبار الحي في `apps/api/src/modules/orders/README.md`.

---

## §8. الطوارئ — تحسينات — 🔄 خلص جزئيًا (فوق اللي خلص في Part C)

**موجود بالفعل**: بث لكل الفنيين بتجاهل `is_available`، دفعة أكبر، إشعار فوري للأدمن، عمولة إضافية قابلة للتعديل (`commission.emergency_adjustment_percentage`).

**اتقفل**: رسوم إضافية صريحة معروضة للعميل قبل التأكيد — `orders.surge_amount_cents` كان عمود راكد من migration 0007، اتفعّل (`pricing.emergency_surcharge_percentage`، إعداد جديد). SLA زمني معلن (`emergency.sla_minutes`) معروض في المعاينة والطلب الفعلي. تفاصيل كاملة في `apps/api/src/modules/catalog/README.md`.

**اتأجل عمداً**: أولوية/staggering حقيقي داخل الدفعة نفسها (الأقرب ياخد فرصة رد أول قبل الباقي) — الاختيار *مين* يدخل الدفعة أصلاً أساسًا بالمسافة موجود من قبل، بس التوقيت الزمني للأفضلية مفيش قرار عمل واضح له، ومحفوف بمخاطرة تلمس آلية البث الأساسية المستقرة.

---

## §9. تقييم متقدم — ✅ خلص

**موجود بالفعل**: `overall_rating` + `punctuality_rating` + `quality_rating` + `professionalism_rating` + `price_fairness_rating` + تعليق + tags array + صور الطلب (`order_media`).

**اتقفل**: `cleanliness_rating` عمود جديد (migration 0063)، وربط صور "بعد التنفيذ" مباشرة بصف التقييم عبر `order_media.rating_id` جديد + `after_photo_media_ids` في `POST /orders/:id/rate`. تفاصيل كاملة + دليل الاختبار الحي في `apps/api/src/modules/ratings/README.md`.

---

## §10. تتبع الفني اللحظي — ✅ خلص من قبل، **ما تعملش حاجة هنا**

`apps/api/src/modules/orders/order-tracking.gateway.ts` (Socket.IO) + `apps/customer-app/lib/features/tracking/` (`tracking_screen.dart`, `tracking_client.dart`) — موجودين ومختبرين حي من سيشنز سابقة. راجعهم لو محتاج تتأكد بس **متعيدش بناءهم**.

---

## §11. الجدولة المستقبلية/المتكررة — ✅ خلص

طلبات متكررة (كل أسبوع/شهر/سنة) لنفس الخدمة — `recurring_order_templates` (migration 0064) جديد، فحص دوري (مش BullMQ، نفس فلسفة `OrderAutoCancelService`) بيولّد طلب حقيقي عبر `OrdersService.create()` نفسها في كل موعد مستحق. تفضيل فني (مش ضمان، نفس فلسفة "إعادة الحجز") بدل قفل/حجز سلوت مسبق في الـ Scheduler — أبسط ومتسق مع باقي النظام. `POST/GET/PATCH/DELETE /me/recurring-orders`. تفاصيل كاملة + دليل الاختبار الحي في `apps/api/src/modules/orders/README.md`.

---

## §12. قطاع الخدمات المنزلية (نطاق منتج جديد كامل) — ✅ خلص

موديول `domestic-workers` جديد كامل، كيان مستقل تمامًا عن `technicians`/`orders`/`matching` (`docs/adr/0004-domestic-workers-vertical.md`). `UserType.DOMESTIC_WORKER` جديد، `domestic_worker_profiles`+`domestic_worker_bookings` (migration 0066)، دفع حقيقي عبر `WalletsService.doubleEntry`، تجديد شهري تلقائي عبر فحص دوري (نفس فلسفة `OrderAutoCancelService`). بَقّة حقيقية اتلقطت واتصلحت (تحويل أرباح الشغالة محتاج `allowNegativeBalance:true` زي تحويل أرباح الفني بالظبط). تكامل الكاميرات وربط التقييمات بالجدول الأساسي `ratings` اتأجلوا عمداً وموثّقين في الـ ADR. تفاصيل كاملة + دليل الاختبار الحي في `apps/api/src/modules/domestic-workers/README.md`.

---

## §13. نظام العمائر (كود عمارة + QR + اشتراك) — ✅ خلص

`buildings` جديد (migration 0065، `docs/adr/0003-buildings-qr-discount.md`) — كود فريد مولّد تلقائيًا (`next_human_readable_number('BLD')`)، خصم نسبة مئوية قابل للتعديل، QR محلي (مكتبة `qrcode` npm، بدون تكامل خارجي). `orders.building_id` جديد — **متبادل استبعادياً مع `promo_code`** (قرار موثّق في ADR). تتبّع "الاشتراك الشهري" (عدد طلبات فعلي مقابل الحد الأدنى) بدون إنفاذ تلقائي — قرار عمل غير محدد في المصدر الأصلي، مش هيتخترع. تفاصيل كاملة + دليل الاختبار الحي في `apps/api/src/modules/buildings/README.md`.

---

## §14. ترقية أمان دخول الأدمن — Passkeys/WebAuthn + MFA + Step-up Authentication — 🔄 النطاق اتحدد، التنفيذ بادئ (طلب صريح 2026-08-13)

**مصدر الطلب**: رسالة مفصّلة من المالك (2026-08-13) بعد اطّلاعه على تدفق الدخول الحالي (OTP بالموبايل بس لكل الأدوار بما فيها Super Admin). النص الحاكم النهائي المطلوب تسجيله بالحرف (باقي الرسالة أعلاه سياق توضيحي عربي، الفقرة دي هي الـspec الرسمية اللي أي تنفيذ لازم يلتزم بيها):

> Admin authentication must be upgraded from phone-OTP-only authentication. Require phishing-resistant MFA (preferably WebAuthn/passkeys) for Super Admin and other high-privilege roles, with step-up re-authentication for financial, RBAC, security, payout, refund, and account-recovery operations. SMS/phone OTP must not be the sole security factor protecting privileged administrative accounts. Preserve server-side session revocation, role checks, audit logging, trusted-device/session management, and secure recovery procedures.

**التمييز الحاكم بين الأدوار (حسب طبقة الحساسية)**:

| الدور | تسجيل الدخول الأول | الدخول السريع بعدين |
|---|---|---|
| عميل/فني (Customer/Technician app) | رقم موبايل + OTP (موجود بالفعل) | Face ID/بصمة على جهاز موثوق (ميزة تحسين لاحقة، مش أولوية أمنية حرجة زي الأدمن) |
| موظف إداري عادي | رقم موبايل + OTP | Passkey/Authenticator **اختياري** كعامل إضافي، إجباري لو عنده صلاحيات حساسة |
| Super Admin / Finance / أي حد يقدر يعدّل صلاحيات | Phone OTP + Passkey **إجباري** (MFA حقيقي، مش SMS بس ولا حتى SMS+Email لو الاتنين بيرجعوا لنفس رقم الموبايل وقت الاسترجاع) | Passkey (Face ID/Touch ID/Windows Hello/Security Key) بس — السيرفر برضه يتحقق كل مرة إن الحساب `active`، الدور/الصلاحيات ماتسحبتش، والـsession ماتلغاش |

**Step-up re-authentication إجباري** (حتى لو الأدمن عامل Login بالفعل) قبل تنفيذ أي عملية من دي: تغيير حساب صرف/Payout method، اعتماد/تحويل مبالغ كبيرة، إنشاء Super Admin جديد، تغيير Roles/Permissions (`assignRole`/`setRolePermissions`/`cloneRole`)، تعطيل أي طبقة حماية، تغيير رقم هاتف Admin، سحب/إلغاء كل الجلسات (Logout All)، الموافقة على Refund. النمط: `Admin logged in → عملية حساسة → Verify with Passkey again → تنفيذ`.

**Session management مطلوب**: الأدمن يشوف كل الأجهزة/الجلسات المفتوحة بتاعته، يقدر يعمل Logout لجهاز بعينه أو Logout All، وأي تغيير حساس في الحساب (تغيير كلمة سر/رقم موبايل/إلغاء MFA) يلغي الجلسات القديمة تلقائيًا.

**Recovery لازم يكون قوي بنفس القوة**: أخطر ثغرة ممكنة هي "نسيت الحساب → SMS → رجعت Super Admin" — ده بيلغي كل حماية الـPasskey فوق. الـrecovery flow نفسه لازم يخضع لنفس مستوى التحقق (مش يرجع لعامل واحد ضعيف).

**قرارات معمارية لازم تتحسم في ADR قبل أي تنفيذ** (`docs/adr/0011-admin-mfa-passkeys.md` — لسه ماتكتبش):
- تخزين WebAuthn credentials: جدول جديد (`admin_webauthn_credentials` أو مشابه) — `credential_id`, `public_key`, `sign_count` (منع replay)، `device_label`, `created_at`, `last_used_at`. **السيرفر أبدًا ميخزّنش بصمة/بيانات بيومترية خام** — WebAuthn بطبيعتها public-key، الجهاز بس هو اللي بيتحقق محليًا.
- مكتبة WebAuthn لـ NestJS backend (`@simplewebauthn/server` الأشهر) + مكتبة client-side مقابلة لـ`apps/admin` (Next.js، `@simplewebauthn/browser`) — الموظفين بيستخدموا متصفح، مش Flutter، فده يكفي لأدوار الأدمن (العميل/الفني على Face ID/بصمة الموبايل نفسه ميحتاجش WebAuthn، ده مسار منفصل تمامًا لو اتقرر لاحقًا).
- جدول `admin_sessions`/تمديد `refresh_tokens` الموجود ليشمل `device_label`/`last_seen_at`/`ip_address`/`user_agent` عشان شاشة "الأجهزة والجلسات" تقدر تعرض بيانات حقيقية.
- آلية step-up: `sensitive_action_verified_at` على مستوى الـsession، أو توكن مؤقت منفصل قصير العمر (`step_up_token`) بيترجع بعد تحقق Passkey ناجح ولازم يترفق مع الطلب الحساس، صالح لمدة قصيرة (دقايق) بس.
- Recovery flow: قرار عمل صريح مطلوب من المالك قبل التنفيذ (مثلاً: Recovery codes مولّدة وقت تفعيل MFA أول مرة، محفوظة hashed، تُستخدم مرة واحدة بس + تنبيه فوري لكل الجلسات الأخرى — **مش SMS bypass**).

**نطاق العميل/الفني (Face ID/بصمة على جهاز موثوق) مؤجّل قصدًا لبعد ما جزء الأدمن يخلص** — أقل حساسية أمنيًا (مفيش صلاحيات مالية/RBAC)، وتنفيذه مختلف تقنيًا (`local_auth` Flutter package + ربط بـrefresh token المحلي، مش WebAuthn).

**قرار عمل صريح من المالك (2026-08-13، لاحقًا نفس اليوم)**: "اعملها لكل الـHigh-Privilege Roles من البداية، مش Super Admin فقط. أي حساب يقدر يشوف/يتحكم في الفلوس أو يغير Roles/Permissions لازم MFA/Passkey يكون إجباري عليه." — يعني مفيش Phase 1/Phase 2 تدريجي بالدور، النطاق الكامل من أول يوم.

**تعريف "High-Privilege" — لازم يكون ديناميكي بالصلاحية مش بالاسم**: بما إن الـRBAC كامل ديناميكي (ADR-0010، أدمن يقدر ينشئ دور جديد ويمنحه أي صلاحية وقت ما يحب)، تعريف "دور حساس" **مينفعش يكون قايمة أسماء أدوار hardcoded** — لازم يكون فحص صلاحيات حي. المجموعة المحدَّدة (فحص فعلي على `permissions`/`role_permissions` وقت كتابة الـADR):
- `payments.refund`, `payouts.approve`, `orders.adjust_price` — تحكّم مباشر في فلوس.
- `roles.manage`, `roles.grant_unrestricted` — تغيير Roles/Permissions مباشرة.
- `settings.manage` — بيشمل معاملات مالية على مستوى المنصة كلها (نسب عمولة، رسوم طوارئ، حدود موافقة صرف تلقائي) — قرار مني إنه يدخل ضمن "التحكم في الفلوس" بمعناها الواسع.
- `is_super_admin=true` (بيتخطى الـpermission join بالكامل حسب ADR-0010) — يُعامل تلقائيًا كأنه حائز كل الصلاحيات فوق.

**بالتطبيق على الأدوار الافتراضية الموجودة دلوقتي**: `super_admin` (كل الصلاحيات فوق)، `finance` (`payments.refund`, `payouts.approve`) → **الاتنين MFA إجباري**. `ops_manager` عنده `orders.adjust_price` → **MFA إجباري كمان** (تحكّم مباشر في سعر الطلب = فلوس). `recruiter`/`support_agent` — صفر صلاحية من المجموعة دلوقتي → **مش مطلوب لهم MFA حاليًا**، بس لو حد منح أي منهم صلاحية من المجموعة دي مستقبلاً (عبر role builder)، المستخدم بيبقى ملزَم تلقائيًا من غير أي تعديل كود — الفحص ديناميكي وقت الدخول/العملية الحساسة، مش قايمة مجمّدة وقت كتابة الـADR.

---

## §15. محرك إشعارات حقيقي — أولوية/تكرار مُدار من الباك-إند — 🔄 Phase 1 خلص (2026-08-13، فرع `hgotr7`)، الباقي فاضي (طلب صريح 2026-08-13)

**المشكلة الحالية**: كل الإشعارات بتتعامل زي بعضها — نفس القناة، نفس الصوت تقريبًا، ومفيش تفرقة حقيقية بين "لازم رد فوري" و"معلومة بس". أي منطق تكرار/تذكير موجود (لو موجود أصلاً) على مستوى الـclient، يعني لو التطبيق اتقفل أو المستخدم مسح الذاكرة، منطق التذكير بيضيع بالكامل.

**المطلوب المعماري — أربع مستويات أولوية واضحة**:

| النوع | مثال | الصوت | التكرار | الأفعال |
|---|---|---|---|---|
| `critical_offer` | عرض طلب Emergency للفني | قوي ومميز | قصير جدًا داخل نافذة العرض (offer window) بس | قبول / رفض مباشرة من الإشعار نفسه (بدون فتح التطبيق) |
| `action_required` | Quote يستنى موافقة، اختيار فني بديل، دفع معلّق | مميز، متوسط الإلحاح | كل ساعة لحد ما يتحل، بحد أقصى reminders + quiet hours قابلين للإعداد | الفعل المناسب مباشرة (موافقة/رفض/اختيار) |
| `scheduled_job` | شغل مستقبلي اتأكد لفني بعينه | صوت خاص خفيف | تذكيرات ذكية لحد الـacknowledgment بس (مش كل ساعة من لحظة الحجز) — مثلاً: فورًا، بعد ساعة لو ما اتفتحش، صبح اليوم اللي قبله، وقبل الموعد بفترة | عرض التفاصيل — بمجرد ما يتفتح، الـreminders تتوقف |
| `informational` | الفني قبل، الموعد اتحدد، الدفع تم، الطلب اكتمل | عادي | **مرة واحدة بس** — ما تتكررش لأنها مش محتاجة فعل | فتح بس |

**تصحيح صريح على فكرة "الفني رفض → العميل يتنبه كل ساعة"**: الرفض نفسه مش المهم، المهم هل العميل مطلوب منه يعمل حاجة. لو auto-matching هيكمّل تلقائيًا (فني بديل تلقائي)، إشعار واحد بس ("الفني السابق مش متاح، بندوّرلك على بديل") — `informational`. لو العميل لازم يختار فني بديل بنفسه، ده يتحول لـ`action_required` ويتكرر لحد ما يختار.

**نموذج بيانات جديد (schema، لازم ADR قبل التنفيذ — `docs/adr/0012-notification-engine.md`)**: كل صف إشعار (سواء جدول موجود `notifications` بتوسيع، أو جدول جديد `notification_workflows` مرتبط بيه) لازم يحمل:
- `event_type` (نوع الحدث، مرجع لأي entity سبّب الإشعار)
- `priority` (`critical_offer` | `action_required` | `scheduled_job` | `informational`)
- `requires_action` (bool)
- `action_type` (نوع الفعل المطلوب — نص مرجعي، الـclient بيستخدمه يقرر يعرض إيه)
- `entity_id`/`entity_type` (الطلب/العرض/الـquote اللي الإشعار متعلق بيه)
- `acknowledged_at` (nullable — أول ما المستخدم يفتح/يشوف الإشعار)
- `resolved_at` (nullable — أول ما الفعل المطلوب يتم فعليًا، **مش نفس فتح الإشعار**)
- `next_reminder_at` (nullable — الـqueue بتقرأه تقرر امتى تبعت تاني)
- `reminder_count`
- `expires_at` (نافذة العرض بتاعة `critical_offer` تحديدًا، أو حد أقصى زمني لأي نوع تاني)

**التكرار Backend-driven مش Client-only** — Job/queue (BullMQ، نفس البنية التحتية الموجودة بالفعل للـmatching/KPI) هي اللي مسؤولة عن إعادة الإرسال بأمان، بتقرأ `next_reminder_at`/`expires_at`/`reminder_count` وتقرر تبعت تاني ولا لأ. بمجرد ما الفعل يتم (`resolved_at` يتحدد) أو الصلاحية تنتهي (`expires_at`)، أي job معلّق مرتبط بالإشعار ده يتلغي فورًا. كده لو الموبايل اتقفل أو التطبيق اتمسح، منطق التذكير ما يضيعش لأنه أصلاً مش عايش على الجهاز.

**قيود منصّة مهمة (لازم تُحترم، مش نفترض قدرات مش مضمونة)**:
- Android: Notification Channels نفسها بتدّي المستخدم تحكّم في الأهمية/الصوت من إعدادات النظام — التطبيق لازم يحترم القرار ده، مش يفرض صوت.
- iOS: **Time Sensitive** notifications ممكن تتخطى بعض إعدادات Focus/الملخص، بس المستخدم يقدر يعطلها. **Critical Alerts** (تتخطى Silent/DND فعليًا) محتاجة **entitlement خاص من Apple وموافقة مسبقة** — **الخطة ميتبنيش على افتراض إننا هنقدر نستخدمها لخدمة منزلية عادية**، `critical_offer` هيستخدم أعلى أولوية متاحة عادةً (Time Sensitive + heads-up) مش Critical Alert.
- Push مبالغ فيه (زي إعادة إرسال High-Priority كل 3 ثواني) ممكن FCM يعتبره misuse ويقلل أولوية الحساب بالكامل — التكرار المسموح محدود ومُصمّم (نافذة `critical_offer` = إشعار واحد يتحدّث/يتجدّد قليل، مش سيل إشعارات).

**Actionable notification على مستوى الـOS**: `critical_offer` لازم يدعم أفعال مباشرة من الإشعار نفسه (قبول/رفض) بدون فتح التطبيق — ده محتاج `Notification Action Buttons` (Android) و`UNNotificationAction` (iOS)، وبالتالي الـbackend يستقبل الفعل عبر مسار منفصل (push action callback أو silent push processing) مش بس من داخل التطبيق المفتوح.

**كل شيء قابل للإعداد من الأدمن، صفر hardcode**: مدة نافذة الـEmergency offer، الصوت/الـchannel لكل نوع، فترات الـreminders، الحد الأقصى لعدد الـreminders، quiet hours، هل `critical_offer` يتخطى quiet hours ولا لأ، هل `scheduled_job` محتاج acknowledgment أصلًا. ده يتخزن في `SettingsService` الموجود بالفعل (نفس محرك الإعدادات العام) مش جدول منفصل جديد إلا لو الشكل معقد بما يكفي (قرار وقت التنفيذ).

**العلاقة بالبنية الموجودة**: `NotificationRoutingService`/`notifications` module موجودين بالفعل ومختبرين (docs/07 §4 — التوجيه المركزي حسب الدور). المحرك الجديد ده **يوسّع** نفس الموديول (أولوية/تكرار/state machine)، مش يستبدله أو يبني موديول موازي.

**لسه محتاج قرار عمل صريح من المالك قبل البدء الفعلي**: هل نبدأ بـ`critical_offer` بس (أعلى قيمة فورية — ده أساسًا آلية بث الطوارئ/المساعد الموجودة بالفعل، محتاجة بس تتلبس بالـstate machine الجديد)، ولا نبني الـstate machine العامة (الأربع أنواع) من الأول؟ التوصية المبدئية: schema + state machine + queue jobs عامة الأول (أساس مشترك لكل الأنواع)، بعدين توصيل كل نوع بيه واحد واحد بالترتيب: `critical_offer` (الأعلى قيمة، بنية موجودة جزئيًا) → `action_required` → `scheduled_job` → `informational` (الأبسط، آخر واحد).

---

## §16. ملاحظات معمارية عامة (من مراجعة الكود الحالي)

- `OrdersService` بقى بيحمل مسؤوليات كتير (validation, booking mode, matching trigger, company selection, emergency sync, requested technician) — لسه مقبول دلوقتي، بس لو محرك التسعير (§1) اتضاف كمان جواه هيكبر أكتر من اللازم. **قرار مبدئي (يتأكد بـ ADR وقت التنفيذ)**: `PricingEngineService` موديول مستقل من الأول (`apps/api/src/modules/pricing/` — الموديول موجود كـREADME فاضي بالفعل، ده مكانه الطبيعي)، `OrdersService` بينادي عليه بس مش بيحسب هو.
- بعض الـ Response DTOs (خصوصًا في `catalog`/`orders`) بقت بتجمع بيانات كتير — لو كبرت أكتر بعد §1، فكّر في تقسيمها لـ DTOs أصغر مركّبة (composition) بدل واحد ضخم.

---

## سجل التحديثات

- **2026-08-11**: الملف اتعمل لأول مرة — تسجيل الرؤية كاملة قبل أي تنفيذ، حسب طلب صريح من المالك.
- **2026-08-11 (لاحقًا نفس اليوم، فرع `hgotr7`)**: §1 (محرك التسعير) Phase 1 backend خلص بالكامل — migration + evaluator آمن (42 اختبار) + CRUD إداري + endpoints عامة، اختبار حي مطابق لمثال المحارة في §1.8 بالظبط. تفاصيل كاملة في `apps/api/src/modules/pricing/README.md`. PR #32.
- **2026-08-12 (فرع `hgotr7`)**: §2 (Scheduler) خلص — `technician_schedule_slots` (migration `0058`، ADR-0002) + `TechnicianScheduleService` (حجز ذرّي، فحص تداخل) + endpoints إدارة/عرض. اختبار حي كامل بما فيه اختبار سباق حقيقي على مستوى الداتابيز (تحديثين متزامنين، واحد بس نجح). تفاصيل كاملة في `apps/api/src/modules/technicians/README.md`.
- **2026-08-12 (لاحقًا نفس اليوم، فرع `hgotr7`)**: §3 (اختيار الفني قبل الحجز) خلص — `GET /services/:id/technicians?address_id=...` (عام)، ترتيب تقييم→قرب PostGIS حقيقي→عدد طلبات مكتملة لنفس الخدمة، مطابق تمامًا لطلب المالك. اختبار حي بفنيين حقيقيين بإحصائيات مختلفة أثبت الترتيب صح. تفاصيل كاملة في `apps/api/src/modules/catalog/README.md`.
- **2026-08-12 (لاحقًا نفس اليوم، فرع `hgotr7`)**: §4 (بروفايل الفني العام — تحسينات) خلص — شهادات/كورسات (`technician_certificates`, migration `0059`, مراجعة أدمن approve/reject قبل الظهور) + `avg_arrival_minutes`/`avg_completion_minutes` (حساب حقيقي من طوابع `orders` الزمنية الموجودة). راجعت `on_time_rate` المذكور في الفجوة كـ"دايمًا null" ولقيته **مش بَقّة** — بيرجّع null لسبب سليم. اختبار حي كامل (رفع→محجوب لحد الموافقة→ظاهر بعدها→رفض بلا سبب اترفض→مراجعة مزدوجة اترفضت 409→حذف ذاتي اختفى فورًا). تفاصيل كاملة في `apps/api/src/modules/technicians/README.md`.
- **2026-08-12 (لاحقًا نفس اليوم، فرع `hgotr7`)**: §5 (فرق العمل) — توزيع الأدوار داخل الطلب خلص: `order_team_members` (migration `0060`) إضافي فوق `orders.technician_id`، قائد الطلب بيضيف أعضاء من نفس شركته بدور نصي حر. مقياس الإنتاجية المجمّعة اتأجل عمداً (قرار عمل مش واضح). اختبار حي كامل بشركة/فريق حقيقيين وطلب `team` حقيقي. تفاصيل كاملة في `apps/api/src/modules/orders/README.md`.
- **2026-08-12 (لاحقًا نفس اليوم، فرع `hgotr7`)**: §7 (الضمان وإعادة الزيارة) خلص — `orders.warranty_expires_at`/`parent_order_id` كانوا أعمدة راكدة من migration 0007، اتفعّلوا بدل ما يتعملوا أعمدة جديدة. `warranty_expires_at` بيتحسب وقت الاكتمال، "إعادة زيارة" مجانية بالكامل لنفس الخدمة/العنوان تحت الضمان. بَقّة حقيقية اتلقطت واتصلحت (`doubleEntry` بترفض مبلغ صفر → طلب مجاني كان بيعلق في `work_completed` للأبد). اختبار حي كامل بدورة طلب حقيقية كاملة. تفاصيل كاملة في `apps/api/src/modules/orders/README.md`.
- **2026-08-12 (لاحقًا نفس اليوم، فرع `hgotr7`)**: §8 (الطوارئ) خلص جزئيًا — `orders.surge_amount_cents` عمود راكد تاني من migration 0007، اتفعّل كرسوم طوارئ صريحة (20% افتراضي، إعداد قابل للتعديل)، + SLA معلن (60 دقيقة افتراضي). معروضين في المعاينة قبل التأكيد وفي الطلب الفعلي بنفس القيمة بالظبط. أولوية/staggering داخل الدفعة اتأجلت عمداً (مخاطرة + مفيش قرار عمل واضح). اختبار حي كامل. تفاصيل كاملة في `apps/api/src/modules/catalog/README.md`.
- **2026-08-12 (لاحقًا نفس اليوم، فرع `hgotr7`)**: §9 (تقييم متقدم) خلص — `cleanliness_rating` عمود جديد فعلاً (مش راكد) + `order_media.rating_id` لربط صور "بعد التنفيذ" مباشرة بالتقييم. فحص صريح قبل إنشاء التقييم (fail fast لو صورة من طلب تاني). اختبار حي كامل. تفاصيل كاملة في `apps/api/src/modules/ratings/README.md`.
- **2026-08-12 (لاحقًا نفس اليوم، فرع `hgotr7`)**: §11 (الجدولة المستقبلية/المتكررة) خلص — `recurring_order_templates` (migration 0064) جديد، فحص دوري بيولّد طلب حقيقي عبر `OrdersService.create()` نفسها في كل موعد مستحق (تفضيل فني مش قفل سلوت). اختبار حي كامل: قالب أسبوعي حقيقي ولّد طلب فعلي بعد ما الموعد استحق، `next_run_at` اتحرّك +7 أيام بالظبط. تفاصيل كاملة في `apps/api/src/modules/orders/README.md`.
- **2026-08-12 (لاحقًا نفس اليوم، فرع `hgotr7`)**: §13 (نظام العمائر) خلص — موديول `buildings` جديد كامل (`docs/adr/0003-buildings-qr-discount.md`)، كود مولّد تلقائيًا، QR محلي (`qrcode` npm)، خصم متبادل استبعادياً مع `promo_code`. اختبار حي كامل: عمارة حقيقية → كود `BLD-2026-000001` تلقائي → طلب حقيقي بالكود → خصم 15% بالظبط. تفاصيل كاملة في `apps/api/src/modules/buildings/README.md`.
- **2026-08-12 (لاحقًا نفس اليوم، فرع `hgotr7`)**: §12 (قطاع الخدمات المنزلية) خلص — موديول `domestic-workers` جديد كامل، مستقل تمامًا عن `technicians`/`orders` (`docs/adr/0004-domestic-workers-vertical.md`). دفع حقيقي عبر `WalletsService.doubleEntry`، حجوزات بالساعة وشهرية مقيمة، تجديد تلقائي دوري. بَقّة حقيقية اتلقطت واتصلحت (`allowNegativeBalance` لتحويل أرباح الشغالة). اختبار حي كامل من التسجيل للتجديد التلقائي. تفاصيل كاملة في `apps/api/src/modules/domestic-workers/README.md`. **بكده docs/08 §1-§13 كلهم خلصوا.**
- **2026-08-12 (مراجعة booking flow الشاملة، لاحقًا نفس اليوم، فرع `hgotr7`)**: اكتُشفت أثناء مراجعة عميقة لـ`OrdersService.create()` **أخطر فجوة تسعير في المشروع كله لحد اللحظة دي**: §1 كان موثّق "Phase 1 backend خلص" فعلاً (المحرك نفسه + endpoints المعاينة العامة `evaluate-price` شغالين صح)، بس `CatalogService.estimate()` — نقطة التسعير الوحيدة اللي `POST /orders` الفعلي بينادي عليها — **كانت أصلاً مش عارفة `pricing_model=formula` خالص**، فأي طلب حقيقي لخدمة formula كان بيتحجز مجانًا بالكامل (`0` قرش) بصمت من غير أي خطأ. اتقفلت: `estimate()` بقت بتتفرّع لـ`PricingEngineService.evaluate()` لو الخدمة formula، `field_values` بقت threaded من `CreateOrderDto`/`ValidatePromoCodeQueryDto` لحد `POST /orders`/`GET /promo-codes/:code/validate`. اختبار حي كامل (خدمة formula حقيقية، سعر 2110 قرش مطابق تمامًا لـ`evaluate-price`، رسوم طوارئ فوقه صح، رفض واضح بدل صفر صامت، صفر orphan rows). تفاصيل كاملة في `apps/api/src/modules/pricing/README.md` قسم "الربط بمسار إنشاء الطلب".
- **2026-08-12 (لاحقًا نفس اليوم، فرع `hgotr7`)**: §2 (Scheduler) بقى خلص **بالكامل** — التكامل الكامل مع `OrdersService.create()` اللي كان مؤجّل عمداً من 2026-08-11 اتبنى: `CreateOrderDto.schedule_slot_id` بيشتق `requestedTechnicianId`/`scheduledAt` تلقائيًا من السلوت، `bookSlot()` بقت تاخد `EntityManager` اختياري عشان تتنادى ذرّيًا جوّه transaction إنشاء الطلب نفسه (سباق حقيقي = رول باك كامل مش طلب بلا سلوت)، و`ScheduleSlotReleaseListener` جديد (نفس نمط `TechnicianStatsRecalculationListener`) بيحرر السلوت مركزيًا عند أي إلغاء. `apps/customer-app`'s `TechnicianProfileScreen` بقى بيعرض السلوتات الفاضية ويسمح بالحجز مباشرة عليها. اختبار حي كامل بما فيه سباق حقيقي بين عميلين على نفس السلوت (واحد بس نجح) وتحرير السلوت بعد إلغاء العميل والفني الاتنين. تفاصيل كاملة في `apps/api/src/modules/technicians/README.md` و`apps/api/src/modules/orders/README.md`.
- **2026-08-13 (فرع `hgotr7`)**: ثلاث قرارات عمل صريحة من المالك اتقفلت مع بعض. **(1) إنتاجية الفريق/المدة** (§5) — `orders.standard_data_id`/`required_technicians`/`required_assistants`/`estimated_duration_days` جديدة (migration `0074`)، `estimateDuration()` الموجودة من Part C بقت متوصّلة فعليًا بـ`POST /orders`. **(2) مضاعف مستوى الفني قبل التأكيد** (يوسّع §3) — `estimate()`/`GET /services/:id/technicians`/`POST /orders/preview` بقوا يستحضروا مستوى الفني الفعلي ويعرضوا السعر النهائي لكل مرشّح قبل الاختيار، مفيش مفاجأة سعر بعد التأكيد. **(3) مطابقة المساعد التلقائية** (§6، subsystem جديد بالكامل) — موديول `assistant-matching` جديد، أولوية مساعد شخصي ثم بث تنافسي ذرّي لمجمع مؤهّل (`docs/adr/0007-assistant-pool-matching.md`). الثلاثة اتبنوا بإعادة استخدام محركات حسابية كانت موجودة ومختبرة بمعزل من قبل (مفيش محرك جديد مكرر)، اتختبروا حي بالكامل بأمثلة المالك بالحرف (120م²/30م²/يوم→4أيام؛ فني premium 1.20×→1000→1200ج.م؛ سباق قبول متزامن حقيقي فايز واحد بس)، ووصلوا لواجهات `apps/admin`/`apps/customer-app`/`apps/technician-app`. تفاصيل كاملة في `apps/api/src/modules/orders/README.md`، `apps/api/src/modules/catalog/README.md`، `apps/api/src/modules/assistant-matching/README.md`.
- **2026-08-13 (لاحقًا نفس اليوم)**: مراجعة تقنية تفصيلية تانية من المالك (18 بند) — اتقفلت بالكامل: GPS حقيقي بدل إدخال يدوي (`geolocator`) في `apps/technician-app`/`apps/customer-app` (مشاركة موقع الفني، تحديث موقع الشغالة، اختيار عنوان العميل عبر خريطة تفاعلية) + فحص `isMockLocation` بقى له معنى حقيقي، معرض صور الفني بعد إعادة فتح التطبيق، إعادة اتصال socket لحظة `awaiting_quote_approval`، اختيار دور عند إنشاء موظف، **تعيين مساعد يدوي من الأدمن بعد التصعيد** (ADR-0008 — كانت مؤجّلة صراحة في ADR-0007 §7)، و**تعارض جدولة صريح في المطابقة التلقائية** (`technician_schedule_slots`، مش بس "مفيش طلب نشط دلوقتي") — للفني القائد (`matching.service.ts`) وللمساعد (`assistant-matching.service.ts`) الاتنين. تفاصيل كاملة في `apps/api/src/modules/matching/README.md`، `apps/api/src/modules/assistant-matching/README.md`، `apps/api/src/modules/orders/README.md`، `docs/adr/0008-manual-assistant-assignment.md`. **لسه مؤجّل من نفس المراجعة، موثّق صراحة تحت**: إعادة ترتيب تدفق الحجز لخدمات formula (يجمع قيم الحقول قبل عرض قايمة الفنيين، مش بعدها — تعقيد UI مش مصحّح بيانات، مؤجّل بسبب مخاطرة إعادة الهيكلة على شاشة `create_order_screen.dart` المعقّدة والمختبرة أصلاً)، وتأجيل بدء المطابقة للطلبات المجدولة بعيدًا (`deferred dispatch` — معمارية جديدة كاملة تحتاج ADR منفصل، تفاصيل الأسباب في نهاية الملف ده).
- **2026-08-13 (لاحقًا نفس اليوم)**: محرر شجرة بصري (No-Code كامل) لمعادلة التسعير بدل JSON textarea في `apps/admin` — كانت فجوة موثّقة صراحة من نفس المراجعة (P1). تفاصيل كاملة في `apps/api/src/modules/pricing/README.md` § مرحلة 3.
- **2026-08-13 (لاحقًا نفس اليوم)**: **مرحلة 2 من محرك الإنتاجية الذاتي التعلّم (§3.9، migration `0077`) — ✅ خلصت**: كانت فجوة موثّقة صراحة ("تسجيل يدوي فقط، لسه مش مربوطة تلقائيًا بالطلبات، مفيش automatic learning من completed orders ولا suggested standard update"). الـpipeline الكامل بقى شغال: التقاط تلقائي (`ORDER_STATUS_CHANGED_EVENT` لحظة `COMPLETED`، `orders.requested_units` عمود جديد لتخزين الوحدات المطلوبة وقت الحجز) → تجميع دوري (median القيم المُطبّعة، فحص كل ساعة أو فوري عبر endpoint) → اقتراح (`service_productivity_suggestions` جديدة، مع `confidence_score` استرشادي) → موافقة/رفض الأدمن الصريحة (**مفيش تحديث تلقائي بلا موافقة أبدًا**). اتعمله اختبار حي كامل (median/confidence اتحققوا يدويًا بالحساب، موافقة حدّثت الرقم القياسي فعليًا + audit log، رفض تكرار الاقتراح، رفض إعادة مراجعة اقتراح اتراجع بالفعل). تفاصيل كاملة في `apps/api/src/modules/catalog/README.md` § محرك الإنتاجية الذاتي التعلّم.
- **2026-08-13 (لاحقًا نفس اليوم، PR #88)**: **توقيع Android للإصدار (Release Signing) — ✅ خلص**: كانت فجوة موثّقة صراحة من نفس المراجعة (P1) — `apps/customer-app`/`apps/technician-app` كانوا بيستخدموا debug signing حتى في release build، بيمنع أي رفع على Play Store. اتقفلت بنفس فلسفة `google-services.json` الشرطية الموجودة بالفعل بالحرف: لو `android/key.properties` (ملف مش متتبّع في git لكل تطبيق) موجود، توقيع الإصدار الحقيقي بيتفعّل تلقائيًا من قيمه؛ من غيره fallback لتوقيع debug زي الأول — أي حد يقدر يعمل build عادي من غير keystore حقيقي لسه. `key.properties.example` (قالب فاضي) لكل تطبيق + خطوات توليد الـkeystore والتحقق في `docs/03-external-integrations.md` §7 الجديد. **ملاحظة صريحة**: التحقق كان مراجعة Kotlin DSL syntax يدويًا + `./gradlew help` (وصل لمرحلة resolve الملفات بنجاح قبل ما يقف على تحميل Android Gradle Plugin بسبب قيد شبكة في بيئة التطوير، مش خطأ في كودنا) — مفيش build فعلي كامل بـkeystore حقيقي اتنفذ لأن البيئة السحابية معندهاش Android SDK كامل، موثّق صراحة في الـdocs عشان أول build حقيقي يتأكد بنفسه.
- **2026-08-13 (لاحقًا نفس اليوم، فرع `hgotr7` — رسالة جديدة من المالك، تسجيل قبل أي تنفيذ)**: طلبين كبار جداد اتسجّلوا بالكامل قبل ما يتلمس أي كود، حسب المبدأ الحاكم في `CLAUDE.md`. **§14 (جديد)**: ترقية أمان دخول الأدمن — Passkeys/WebAuthn + MFA إجباري لـSuper Admin وباقي الأدوار عالية الصلاحية + step-up re-authentication للعمليات الحساسة (مالية/RBAC/أمان/صرف/استرداد/استرجاع حساب) + إدارة أجهزة/جلسات + recovery قوي بنفس مستوى الحماية. النص الإنجليزي الرسمي المطلوب الالتزام بيه اتسجّل بالحرف. **§15 (جديد)**: محرك إشعارات حقيقي بأربع مستويات أولوية (`critical_offer`/`action_required`/`scheduled_job`/`informational`) — تكرار/تذكير مُدار بالكامل من الباك-إند (`event_type`, `priority`, `requires_action`, `action_type`, `entity_id`, `acknowledged_at`, `resolved_at`, `next_reminder_at`, `reminder_count`, `expires_at`) عبر queue jobs، مش منطق client-only بيضيع لو التطبيق اتقفل. **الاتنين لسه ⬜ فاضيين بالكامل** — محتاجين ADR (`0011-admin-mfa-passkeys.md`, `0012-notification-engine.md`) وقرار عمل صريح من المالك (نطاق البداية) قبل أي تنفيذ فعلي، تفاصيل كاملة في القسمين نفسهم.
- **2026-08-13 (لاحقًا نفس اليوم، فرع `hgotr7`)**: **§15 (محرك الإشعارات) Phase 1 خلص** —
  `docs/adr/0012-notification-engine.md` اتكتب أولاً، بعدين التنفيذ: migration `0087` (`notification_type_configs`
  + `notification_workflows` + `notifications.workflow_id`)، `NotificationWorkflowService`،
  `NotificationWorkflowReminderService` (sweep دوري زي `OrderAutoCancelService` بالحرف، مش
  BullMQ — نفس درس بَقّة انقطاع Redis الموثّقة قبل كده)، وربط حقيقي أول (موافقة عرض السعر
  `awaiting_quote_approval` — أنسب مثال `action_required` موجود بالفعل). اتعمله اختبار حي كامل
  عبر `curl` (عميل/فنيين حقيقيين، دورة طلب كاملة لـ`awaiting_quote_approval` وموافقة)، بما فيه
  **تأكيد حي لقيد ساعات الهدوء** (أول محاولة sweep حقيقية صادفت ساعات الهدوء الافتراضية فعليًا
  وأجّلت التذكير صح) و**تأكيد حي للتذكير نفسه** بعد تضييق الهدوء مؤقتًا (`reminder_count`
  اتزود، `next_reminder_at` اتحرك +60 دقيقة، صف `notifications` جديد اترتبط بنفس الـworkflow).
  `tsc`/`nest build`/`jest` الثلاثة عدّوا نضيف (88 اختبار، +10 جداد لـ`quiet-hours.util`). تفاصيل
  كاملة في `apps/api/src/modules/notifications/README.md`. **بَقّة بيئة تانية اتلقطت واتصلحت
  أثناء الشغل**: `schema_migrations` كانت واقفة عند `0082` بينما migrations `0083-0086` كانت
  فعليًا مطبّقة بالكامل على القاعدة (من سيشنز/إعادة تشغيل سابقة) — اتأكد بفحص كل جدول/عمود
  متوقّع لكل migration قبل إدراج صفوف التتبّع يدويًا، مش افتراض. **نطاق Phase 1 بس — الباقي
  (`scheduled_job`, `critical_offer` actionable push, واجهة أدمن لـ`notification_type_configs`)
  موثّق صراحة كمتبقٍ في الـADR وفي `notifications/README.md`.**
