# منهج التحقيق والتنفيذ الإلزامي لأي موديل

## 1. الهدف

هذه الوثيقة تحدد طريقة التفكير والعمل المطلوبة في المشروع كله. الغرض ليس زيادة عدد الأوامر أو طول الرد، بل الوصول إلى قرار صحيح من التنفيذ الفعلي، ثم بناء تغيير مترابط وقابل للاختبار والتوسع.

المنهج ينطبق على:

- التحقيقات والـaudits والـcode review.
- إصلاح البقّات.
- الميزات الجديدة والتغييرات المعمارية.
- الأموال، الطلبات، الجدولة، المطابقة، الإشعارات، الصلاحيات والواجهات.
- أي handoff بين موديلات أو مطورين.

## 2. قواعد لا تفاوض عليها

1. **الكود الحالي هو الدليل الأول.** README وADR والتقارير تساعد على الفهم، لكنها لا تثبت أن التنفيذ ما زال مطابقًا لها.
2. **ثبّت النسخة التي راجعتها.** سجّل الفرع وSHA، وحدّث من remote بأمان عندما يطلب المالك أحدث `main`.
3. **احمِ العمل الموجود.** افحص `git status` قبل أي شيء. لا تعدّل أو تمسح أو تدخل في commit تغييرات لم تنشئها.
4. **لا تبدأ بحل مفترض.** افهم مسار التنفيذ الحالي، مصادر الحقيقة، الحالات، والعقود قبل اقتراح التغيير.
5. **لا تعتبر اسم الدالة دليلًا على سلوكها.** اقرأ body، الاستدعاءات، الاستعلامات، الـevents، والـconsumers.
6. **لا تكرر مصدر حقيقة.** ابحث عن service أو engine أو policy قائمة ووسعها بدل إنشاء مسار ثانٍ ينافسها.
7. **كل slice يجب أن تكون end-to-end.** Backend وحده أو UI وحدها لا تعتبر ميزة مكتملة إذا كان المستخدم أو الأدمن لا يستطيع إتمام المسار.
8. **الأموال والحالات لا تقبل fallback صامت.** أي عدم اتساق يجب أن يفشل بوضوح، يبقى قابلًا للمراجعة، ولا يختفي داخل `try/catch`.
9. **فرّق بين الحقيقة والاستنتاج والقرار.** لا تعرض inference كأنه حقيقة مثبتة.
10. **لا تقل “تم” بلا دليل.** اذكر ما اختبرته، ما لم تختبره، وأي مخاطرة متبقية.

## 3. بوابة ما قبل العمل

### 3.1 تثبيت نقطة البداية

ابدأ دائمًا بجمع:

- `git status` والفرع الحالي.
- SHA الحالي ومقارنته بالـremote المطلوب.
- آخر commits ذات الصلة.
- الملفات المحلية المعدلة أو غير المتتبعة ومن يملكها.
- migrations الأخيرة وترتيبها.

لو `main` تغيّر أثناء التحقيق، أعد التحقق من النتائج المتأثرة. كل تقرير كبير يذكر SHA الذي بُني عليه.

### 3.2 تحويل الطلب إلى مصفوفة قبول

قسّم الطلب إلى بنود قابلة للإثبات قبل لمس الكود:

| البند | السلوك الحالي | السلوك المطلوب | Backend | Admin | Customer | Technician | DB/Migration | Notification/Realtime | Tests | الحالة |
|---|---|---|---|---|---|---|---|---|---|---|

الحالات المسموحة:

- `CONFIRMED_EXISTING`: موجود ومثبت ولا يحتاج تعديلًا.
- `GAP`: غير موجود أو ناقص.
- `BUG`: موجود لكن السلوك الفعلي خطأ.
- `STALE_FINDING`: الملاحظة قديمة وتم إصلاحها بالفعل.
- `CONFLICT`: يتعارض مع قرار أحدث للمالك أو ADR نافذ.
- `DECISION_REQUIRED`: له نتائج مالية/تشغيلية غير بديهية ويحتاج قرار المالك.
- `IMPLEMENTED`: نُفّذ واختُبر.
- `UNVERIFIED`: لا يوجد دليل كافٍ بعد.

لا تبدأ التنفيذ قبل أن تعرف تعريف النهاية لكل بند.

## 4. طريقة التحقيق الصحيحة

### 4.1 ابدأ بخريطة، لا بقراءة عشوائية

حدّد أولًا:

- الموديولات والـcontrollers والـservices والـentities والـDTOs.
- state machine والحالات النهائية والانتقالات.
- migrations والقيود والفهارس والـenums.
- events والlisteners والqueues والrealtime gateways.
- إعدادات runtime ومكان default/seed/UI لكل setting.
- تطبيقات المستخدم والأدمن التي تستهلك العقد.
- الاختبارات الموجودة التي تثبت السلوك.

استخدم البحث لاكتشاف كل المواضع، ثم اقرأ الملفات المركزية كاملة أو المدى الوظيفي كاملًا. لا تكتفِ بأول نتيجة بحث.

### 4.2 تتبع التنفيذ بالترتيب الفعلي

لكل flow اكتب decision flow حسب ترتيب التنفيذ، مثل:

1. التحقق من الهوية والصلاحية.
2. idempotency short-circuit.
3. تحميل الكيانات وقفل الصفوف.
4. validation وpolicy gates.
5. الحساب أو transition.
6. الكتابة داخل transaction.
7. audit/history/ledger.
8. event emission.
9. notification/realtime consumers.
10. انعكاس النتيجة في كل UI.

لو كانت المهمة مالية، تتبع كل قرش من المدخل حتى ledger والمحفظة والاسترداد. لو كانت طلبات، تتبع الحالة من API حتى state machine والمطابقة والتطبيقات.

### 4.3 افحص العرض والكتابة معًا

لكل قيمة مهمة اسأل:

- من يحسبها؟
- من يكتبها؟
- من يستطيع تعديلها لاحقًا؟
- هل هي snapshot أم derived؟
- من يعرضها للعميل والفني والأدمن؟
- ما الذي يحدث عند retry أو double-submit أو crash بين خطوتين؟
- ما هو DB invariant الذي يمنع حالة مستحيلة؟

لا يكفي العثور على endpoint؛ تأكد أن المستهلك الحقيقي يناديه وأن الرد يُعرض بشكل صحيح.

### 4.4 التحقيق المتوازي المنضبط

يمكن تقسيم القراءة المستقلة بالتوازي، مثل:

- pricing/catalog.
- orders/state machine.
- payments/refunds/installments.
- matching/scheduling/concurrency.
- notifications/audit/RBAC/settings/realtime.
- customer/admin/technician UI.
- tests/migrations/documentation.

لكن يجب دمج النتائج في خريطة واحدة قبل التنفيذ. يمنع أن يعدّل عاملان نفس العقد أو مصدر الحقيقة في وقت واحد بدون تنسيق.

### 4.5 معيار الدليل

أي audit أو handoff تقني يجب أن يحتوي على:

- مسار كامل + `file:line` دقيق.
- signature أو query أو transition ذي الصلة، باقتباس قصير عند الحاجة.
- caller وconsumer، وليس التعريف فقط.
- اسم migration/constraint عند الحديث عن DB.
- اسم spec والحالة التي يثبتها عند الحديث عن الاختبارات.
- SHA الذي تمت مراجعته.

استخدم عبارات واضحة:

- **Fact:** مثبت من الكود/الاختبار.
- **Inference:** استنتاج منطقي يحتاج تحققًا حيًا.
- **Gap:** لا يوجد consumer/constraint/test أو المسار غير مكتمل.
- **Decision:** اختيار له trade-off ويخص المالك.

## 5. عدسات إلزامية للمسارات الحساسة

### 5.1 الأموال

راجع دائمًا:

- مصدر السعر ومكوناته والعملة والوحدة.
- الخصم، الإيداع، رسوم الطوارئ، الضمان، العمولة، وحصص الطاقم.
- المبلغ المدفوع والمستحق والممول والمسترد.
- payment intent/webhook/idempotency/reconciliation.
- cash direction والدين على الفني والمحفظة والledger.
- full/partial refund ومن يتحمل كل جزء.
- snapshot والسياسة/الخوارزمية المستخدمة وقت العملية.
- invariants قبل وبعد كل transition.

أي تغيير سعر بعد التزام دفع يجب أن يمر من مسار مالي مركزي، لا بتعديل مباشر لحقل الإجمالي.

### 5.2 الحالات والطلبات

راجع:

- enum + state machine + DB constraints.
- كل نقطة كتابة للحالة.
- status history وaudit.
- matching/recovery/cancellation/reschedule.
- الأحداث بعد commit، ومن يستهلكها.
- deep links والإشعارات وrealtime.
- ما يراه كل actor في نفس اللحظة.

### 5.3 التزامن والـidempotency

ابحث عن:

- transaction boundaries.
- `SELECT ... FOR UPDATE` أو pessimistic locks.
- unique/partial indexes.
- idempotency keys.
- compare-and-set أو status guards.
- first-accept-wins وإعادة التحقق داخل القفل.
- retries بعد فشل جزئي.

اختبار happy path وحده لا يكفي للموافقة، الدفع، الاسترداد، المطابقة أو توزيع الأموال.

### 5.4 الصلاحيات والأمان

تتبع permission من registry/seed إلى decorator ثم service guard ثم UI visibility. إخفاء الزر ليس حماية. افحص ownership، MIME/size/file references، signed access، secrets، logs، وaudit actor metadata.

### 5.5 الإشعارات والـrealtime

لا تعتبر event emission نهاية المسار. أثبت:

- النوع مسجل ومسموح بقنواته.
- listener مشترك في الحدث الصحيح.
- المستلم الصحيح يُحل من profile/user.
- deep link يفتح شاشة موجودة.
- فشل push لا يلغي العملية الأساسية.
- العميل/الفني/الأدمن يحصل على تحديث قابل للفهم.

## 6. من التحقيق إلى خطة التنفيذ

بعد الخريطة، اكتب خطة قصيرة مرتبة حسب dependencies:

1. العقد وقرار مصدر الحقيقة.
2. migration توسعية وآمنة إن لزم.
3. domain service والسياسات.
4. API/DTO/shared types.
5. events/notifications/realtime/audit.
6. Admin UI.
7. Customer/Technician UI.
8. tests وregression.
9. توثيق الموديول وADR عند القرار المعماري.

صعّد للمالك فقط عندما توجد اختيارات ذات أثر غير بديهي، مثل من يتحمل refund أو هل السعر يتجمد بعد الدفع. اعرض الخيارات وتأثير كل واحد. لا تسأل عن تفاصيل يمكن اكتشافها من المشروع.

## 7. قواعد التنفيذ

### 7.1 Slice عمودية كاملة

نفّذ أصغر slice تحقق قيمة كاملة. مثال الموافقة على عرض سعر لا تكتمل إلا بوجود:

- حالة وعقد DB صحيحان.
- endpoint مؤمّن وidempotent.
- قفل يمنع double approval.
- تحديث مالي ذري.
- history/audit.
- إشعار وrealtime.
- UI للفاعل والمستلم.
- اختبارات نجاح وفشل وتزامن.

### 7.2 migrations

استخدم `Expand -> Backfill -> Switch -> Verify -> Cleanup`:

- لا تعدّل migration منشورة.
- افحص legacy data قبل constraint جديد.
- أعطِ كل column/default/index معنى تشغيليًا موثقًا.
- لا تضف setting أو column لا يقرأه runtime.
- cleanup المدمر مرحلة منفصلة بعد التحقق.

### 7.3 التوافق وعدم التكرار

- حافظ على API القديم أو اعمل migration/version واضحًا.
- حدّث shared contracts وكل المستهلكين معًا.
- أزل المسار القديم فقط بعد إثبات عدم وجود callers.
- لا تنشئ engine أو status أو table بديلة لأن الموجود صعب؛ أصلح المصدر المركزي.

### 7.4 Git

- commit واحد لكل slice مترابطة، وليس لكل ملف.
- stage الملفات التي أنشأتها فقط.
- لا تضم تغييرات المستخدم أو generated files غير المقصودة.
- لا تعمل push قبل verification مناسب.
- بعد push اذكر SHA والفرع وتأكد أن local وremote متطابقان.

## 8. استراتيجية الاختبار

رتب الاختبارات من الأرخص للأوسع:

1. unit للقاعدة أو الحساب.
2. integration حقيقي مع DB للقيود والمعاملات.
3. concurrency/idempotency للحالات الحساسة.
4. API contract والnegative paths.
5. widget/component للعرض والتفاعل.
6. end-to-end للمسار الكامل.
7. regression للموديولات المتأثرة، ثم build/typecheck/lint المناسب.

الاختبار يجب أن يثبت invariants، لا مجرد status code. في الأموال افحص ledger والأرصدة والإجماليات. في المطابقة افحص الفائز الوحيد وحالة الخاسرين. في الإشعارات افحص المستلم والنوع والمرجع والـdeep link.

لا تكرر suite ثقيلة بلا داعٍ بعد كل تعديل صغير؛ شغّل targeted أثناء البناء ثم regression مجمع قبل الإغلاق.

## 9. شكل تقرير التحقيق

التقرير الجيد كثيف وقابل للتنفيذ، ويُرتب حسب بنود طلب المالك:

```text
Audit baseline: <branch> @ <sha>

1. <DOMAIN>
- Current behavior, in execution order
- Source of truth
- Exact signatures/queries/transitions with file:line
- Callers and consumers
- Concurrency/idempotency
- UI/notification/realtime visibility
- Existing tests
- Gaps, stale findings, and decisions

Cross-domain invariants
Implementation order
Acceptance tests
```

لا تملأ التقرير بقائمة أسماء ملفات فقط. المطلوب شرح كيف تتعاون الملفات وما الذي يحدث في runtime.

## 10. شكل الإغلاق بعد التنفيذ

الإغلاق يذكر بوضوح:

- النتيجة التي أصبحت ممكنة للمستخدم.
- القرارات المعمارية ومصدر الحقيقة.
- migrations/settings/contracts الجديدة.
- تغييرات Admin/Customer/Technician.
- tests بالأرقام والنتيجة.
- ما لم يُختبر ولماذا.
- المخاطر أو القرارات المتبقية.
- commit SHA والفرع وحالة push.

ممنوع استخدام “كله تمام” أو “جاهز للإنتاج” ما لم تمر بوابات الإطلاق الفعلية في `docs/05-launch-checklist.md` و`docs/23-production-launch-and-google-play-plan.md`.

## 11. ممنوعات

- تنفيذ patch قبل فهم المسار الكامل.
- الاعتماد على README أو اسم function وحدهما.
- كتابة تقرير بلا SHA أو مراجع دقيقة.
- اعتبار TODO أو تعليق دليلًا أن الميزة غير موجودة.
- اعتبار وجود endpoint دليلًا أن الـUI تستخدمه.
- client-only validation أو permission.
- تعديل أموال أو حالة خارج service/transaction المركزية.
- swallowing لعدم اتساق مالي أو أمني.
- إضافة setting لا يقرأه runtime أو عرضه للأدمن بلا أثر.
- duplicate source of truth.
- destructive migration مباشرة.
- خلط تغييرات محلية تخص شخصًا آخر في commit.
- ادعاء اكتمال شامل بعد targeted tests فقط.

## 12. قائمة فحص سريعة قبل أول تعديل

- [ ] قرأت `AGENTS.md` و`CLAUDE.md` وهذه الوثيقة.
- [ ] قرأت README الموديول وADR المرتبط.
- [ ] ثبتُّ branch/SHA وحالة Git.
- [ ] حوّلت الطلب إلى مصفوفة قبول.
- [ ] تتبعت المسار الحالي بالترتيب الفعلي.
- [ ] حددت مصدر الحقيقة والـinvariants.
- [ ] راجعت DB/events/RBAC/audit/notifications/realtime/UI/tests.
- [ ] صنفت الموجود والناقص والمتعارض والقرارات المطلوبة.
- [ ] صممت slice end-to-end وخطة verification.
- [ ] تأكدت أني لن ألمس تغييرات لا تخصني.
