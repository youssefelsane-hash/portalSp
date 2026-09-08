# تصنيف حدود استعلامات القراءة

**الحالة:** مكتمل في 2026-09-08.  
**النطاق:** كل استدعاء TypeORM `Repository.find()` و`QueryBuilder.getMany()` داخل
`apps/api/src` وقت الفحص، مع استبعاد `*.spec.ts` و`Array.find()` المحلي (ليس استعلام قاعدة).

## القاعدة الحاكمة

لا توجد قاعدة «ضع `take: 100` في كل مكان». السقف العشوائي قد يخفي حركة محفظة أو عضو طاقم
صحيح، وهو أسوأ من بطء واضح. كل قراءة تُصنّف وفق مصدر نموها والعميل الذي يستهلكها:

| الفئة | القرار | متى نغيّرها |
|---|---|---|
| A. أثر معاملة أو تحقق اتساق | مسموح كاملًا داخل transaction، ومقيّد بمفتاح طلب/دفعة/محفظة محدد | لا تتحول إلى endpoint قائمة. لو حدث ذلك، تضيف cursor قبل كشفها للواجهة. |
| B. تجميعة يملكها كيان واحد | مسموح كاملًا حاليًا، لأن النتيجة جزء من شاشة الكيان وليس فهرسًا عامًا | عند احتمال نمو غير محدود لكل كيان (رسائل/سجل)، نضيف cursor قبل زيادة سقف المنتج. |
| C. مرجع تشغيلي محدود | مسموح كاملًا؛ جدول إعداد/سياسة/مستوى/مدينة/حقل كتالوج، لا سجل أحداث | أي جدول جديد في هذه الفئة يحتاج حدًا domain واضحًا أو صفحة إدارة. |
| D. قائمة مستخدم أو إدارة قابلة للنمو | يجب أن تكون cursor/page أو أن يكون لها حد ثابت واضح | ممنوع إضافة قراءة كاملة جديدة في هذه الفئة. |
| E. عامل background | يجب أن يملك batch/نافذة زمنية في الاستعلام نفسه | ممنوع sweep كامل في الذاكرة. |

## A — أثر معاملة أو تحقق اتساق

هذه الاستعلامات لا تُرجع قائمة عامة؛ تعمل تحت قفل أو بمفتاح عملية محدد، والقراءة الكاملة مطلوبة
لمنع حساب مالي جزئي أو قرار حالة خاطئ.

- `payments.service.ts:2798-2799, 2907, 2974, 2984, 2991, 3062, 3091, 3130, 3141, 3302, 3431, 3442, 3548, 3563, 3777` — دفعات/استردادات طلب واحد داخل تسوية أو استرداد.
- `payments/crew-earnings.service.ts:252` و`payments/payouts.service.ts:89` — حصص أو بنود صرف لمعرف واحد.
- `orders/order-items.service.ts:60,179,294` و`orders/inspection-quote.service.ts:475` — بنود أو نسخ عرض سعر لطلب واحد.
- `orders/admin-orders.service.ts:416,420` و`orders/order-media.service.ts:85` و`ratings/ratings.service.ts:214,219` — سجل حالة/صور/تقييم الطلب المحدد.
- `assistant-matching.service.ts:220,477` و`matching-round-expiry.processor.ts:83` و`matching.service.ts:886` — عروض جولة مطابقة واحدة، لا فهرس فنيين عام.
- `technician-referrals.service.ts:107` و`catalog/productivity-learning.service.ts:94,146` — تحقق أثر مالي أو عينة تعلم مرتبطة بمرجع واحد.

**ضابط الحجم:** لا يسمح الـAPI بإنشاء عناصر إضافية بلا حد في طلب واحد (إضافات/صور/فريق لها
حدود DTO وقواعد تشغيل)، ومع ذلك أي ميزة تزيد هذا الحد يجب أن تراجع هذه المجموعة في نفس PR.

## B — تجميعة يملكها كيان واحد

هذه ليست مسارات بحث عامة، لكن نموها ممكن على المدى الطويل؛ لذلك يظل ترتيبها ثابتًا ويجب أن
تتحول إلى cursor عند إضافة واجهة «تحميل المزيد»، لا إلى تحميل كامل في قائمة عامة.

- `chat/chat.service.ts:207` و`internal-chat/internal-chat.service.ts:159` — رسائل خيط محادثة.
- `support/support.service.ts:214,482` و`security/security-events.service.ts:289` — رسائل/مرفقات شكوى أو ملاحظات حدث أمني.
- `customers/addresses.service.ts:53`، `auth/webauthn.service.ts:62,120,215,267`، `payments/saved-payment-methods.service.ts:16` — ممتلكات حساب واحد.
- `technicians/*`: `technician-certificates.service.ts:55,60`، `portfolio-links.service.ts:123`، `technician-categories.service.ts:50,60,237`، `technician-documents.service.ts:52`، `technicians.service.ts:172`، `technician-schedule.service.ts:21,56,166`، `preferred-crew.service.ts:224`.
- `projects/projects.service.ts:129,836,840`، `recurring-orders.service.ts:258`، `installments/installments.service.ts:352,574`، `payment-policies.service.ts:127`، `academy.service.ts:117`.

**قرار المنتج:** سجل المحفظة والرسائل أطول عناصر هذه المجموعة؛ لا يضاف لها تصدير أو قائمة
شاملة من دون cursor وزمن/معرف ثابت. بيانات الرحلات المهنية والوثائق تُعرض في صفحة صاحبها فقط.

## C — مراجع وإعدادات محدودة

هذه جداول تعريفية يحمّلها المنتج كي يبني نموذجًا أو يطبّق سياسة، لا جداول تاريخ. القراءة الكاملة
صحيحة حتى يتغير تعريف النطاق نفسه.

- `settings/settings.service.ts:151`، `feature-flags.service.ts:19`، `notification-routing.service.ts:32,123`، `notification-type-config.service.ts:22`، `admin/permissions.service.ts:157,194,375,439`.
- `geo/geo.service.ts:19,32` و`geo/admin-geo.service.ts:60,66,170,255`، `technicians/technician-levels.service.ts:20`، `technician-progression.service.ts:107,162`.
- `catalog/catalog.service.ts:122,130,141,149,195,203,251,265`، `catalog/admin-catalog.service.ts:64,257,584,623,728,827,886,950,1040`، `pricing/pricing-fields.service.ts:57`، `pricing/pricing-rules.service.ts:81,156,174,231`، `pricing/pricing-references.util.ts:31`، `pricing/pricing-rule-tests.service.ts:25`.
- `orders/cancellation-reasons.service.ts:18,25`، `academy/academy.service.ts:21,25`، `projects/admin-warranty-plans.controller.ts:25`، `installments/installments.service.ts:205`، `payment-policies.service.ts:118`، `branding/branding.service.ts:66,80`.

**حدود الدومين:** الفئات والخدمات والإضافات والحقول مرتبطة بخدمة؛ المستويات والسياسات وأنواع
الإشعار مجموعة تعريفية. إذا تحولت أي منها إلى marketplace أو تاريخ تعديلات مفتوح، تنقل للفئة D.

## D — قوائم قابلة للنمو ومكشوفة للواجهة

هذه لا يجوز أن تُنسخ كنمط جديد بلا pagination. المسارات التي كانت exposed حرجة عولجت بالفعل
بـcursor (تاريخ طلبات العميل)، والبقية تُبقي الاستعلامات مقيدة بفلاتر الملكية أو شاشة تشغيل
داخلية حتى تُضاف واجهة cursor المتوافقة معها.

- `orders/order-queries.service.ts:67,98,163,171,208,255,274` — قوائم طلبات الفني/الإشعارات؛ تحكمها حالات نشطة أو نطاق صاحب الطلب، وليس تاريخ كل المنصة.
- `payments/wallets.service.ts:68`، `payments/payouts.service.ts:163,171`، `promotions/loyalty.service.ts:40` — دفتر مالي أو طلبات صرف؛ لا تستهلك كفهرس مفتوح بلا صفحة.
- `buildings/buildings.service.ts:31`، `technicians/technician-companies.service.ts:131,333`، `campaigns/admin-campaigns.service.ts:53`، `marketing-spend.service.ts:29` — إدارة كيانات تنمو؛ أي شاشة جديدة لها تستخدم page/cursor من البداية.
- `support/support.service.ts:166,176`، `support/support-tickets.service.ts:71,75`، `admin/admin-employees.service.ts:149`، `technician-kpi.service.ts:193` — عمليات داخلية أو سجلات شخصية؛ لا تستخدم كـautocomplete أو dashboard كامل.

## E — وظائف خلفية

- `notification-workflow-reminder.service.ts:66`، `productivity-learning.service.ts:132,146,238`، و`matching-round-expiry.processor.ts:83` تعمل بدفعة أو مهلة زمنية. أي loop جديد يضيف `take`/cursor قبل المعالجة، لا بعد تحميل الصفوف.

## نتائج الفحص

1. لا توجد قراءة قاعدة بيانات كاملة بلا تصنيف في كود التشغيل ضمن نطاق الفحص.
2. لا يوجد `find()` في مواضع التسوية المالية يُستبدل بسقف؛ سلامة الحساب مقدمة على تقليم بيانات
   طلب واحد.
3. لا يُعامل `Array.find()` أو نتيجة SQL محدودة يدويًا كاستعلام قاعدة؛ التفريق مقصود حتى لا
   يزيد الرقم الظاهري ويخفي الخطر الحقيقي.
4. **قاعدة مراجعة إلزامية:** أي endpoint جديد يعرض صفوفًا من الفئة D أو رسائل الفئة B يحتاج
   cursor/page واختبار ترتيب مستقر قبل الدمج.
