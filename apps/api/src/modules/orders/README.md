# modules/orders

الطلبات ودورة حياتها الكاملة (state machine مقفولة). جداول: orders, order_status_history, order_items, order_media, order_assignments, cancellation_reasons (قاموس §6). الجدول الأخطر في النظام كله.

**الحالة: شغال (S3 + S5 + S6).**

- `order-state-machine.ts`: مصدر الحقيقة الوحيد لانتقالات الحالة الكاملة (كل الـ 18 حالة من القاموس §6.2)، مقفولة تماماً — أي انتقال مش معرّف فيها يرمي `ORDR_003`. مبنية كاملة من الأول عشان موديولات `matching`/`payments`/`support` تستخدم نفس الملف من غير ما تتلمس تاني.
- **بَقّة حقيقية اتلقطت حيًا واتصلحت (docs/08 §19 بند 1)**: `ORDER_TRANSITIONS[PENDING_PAYMENT]` معندهاش `CANCELLED_BY_CUSTOMER` خالص، رغم إن `CUSTOMER_CANCELLABLE_STATUSES` (نفس الملف) بتدرج `PENDING_PAYMENT` صراحة كحالة "العميل يقدر يلغيها". يعني عميل بدأ دفع مسبق (كارت/InstaPay، ADR-0013) وحاول يلغي قبل ما يكمّل الدفع كان بيترفض `ORDR_003`/409 رغم إن الواجهة بتقوله إنه يقدر — بَقّة غير مرئية لكل اختبارات jest السابقة (مفيش واحد منهم كان بيغطي إلغاء عميل لطلب `pending_payment`)، اتلقطت بس عبر اختبار Flutter حي جديد (`apps/customer-app/test_live/pending_payment_order_creation_live_test.dart`) وقت تنظيف بيانات الاختبار بـ`cancel` عادي. الإصلاح: إضافة `CANCELLED_BY_CUSTOMER` لقايمة انتقالات `PENDING_PAYMENT` (زي `CANCELLED_BY_SYSTEM`/`EXPIRED` الموجودين أصلاً). اتضاف `order-state-machine.spec.ts` جديد — من ضمنه اختبار عام بيتأكد إن **كل** حالة في `CUSTOMER_CANCELLABLE_STATUSES` فعلاً عندها `CANCELLED_BY_CUSTOMER` كانتقال مسموح، يمنع تكرار نفس فئة البَقّة لأي حالة جديدة تتضاف مستقبلاً لأي من القايمتين بمفردها بلا مزامنة القايمة التانية.
- `POST /orders`: بيتحقق من ملكية العنوان، الخدمة نشطة، فيه نطاق خدمة للمدينة (`ORDR_001` لو لأ)، بيحسب السعر التقديري عبر `catalog`، وبيولّد `order_number` من `next_human_readable_number('ORD')` — كل ده جوّه transaction واحدة مع أول صف في `order_status_history`.
- **بَقّة سباق حقيقية اتلقطت واتصلحت — `order.created` كان `emit()` عادي (fire-and-forget) مش `emitAsync()`**: `create()` كان بيصدّر `ORDER_CREATED_EVENT` وبيرجع للعميل فوراً من غير ما يستنى `OrderDispatchListener` (في `matching`) يخلّص إنشاء صفوف `order_assignments`. يعني فيه نافذة زمنية حقيقية (مش نظرية) بين رد `201` لإنشاء الطلب وبين لحظة ما الفني يبقى فعلاً شايف عرض في `GET /technician/orders/available` — أي `accept()` بيتنادى فورًا (نداءين `curl` متتاليين من غير أي تأخير، أو اختبار Dart حي بياخد الرد ويعدّي مباشرة) كان بيترجع `ORDR_003` ("العرض ده مبقاش متاح") رغم إن الطلب سليم ولسه بيتوزّع. اتأكدت البَقّة أول بـ`curl` خام (نداءين ورا بعض من غير تأخير)، وبعدين ظهرت في اختبار Dart حي جديد (`apps/technician-app/test_live/active_order_recovery_live_test.dart`). اتصلحت بتغيير `this.events.emit(...)` لـ`await this.events.emitAsync(...)` — دلوقتي `create()` بتستنى كل الـ listeners (بما فيهم `OrderDispatchListener`) يخلّصوا قبل ما ترجع، فلما العميل يستلم رد الطلب يكون التوزيع للفنيين خلص فعلاً (لطلب فوري/قريب من الموعد). باقي أحداث النظام (إشعارات، إحصائيات) لسه fire-and-forget عمداً في كل موديول تاني — الاستثناء هنا بس لإن قرار التوزيع/التأجيل جزء أساسي من دورة الطلب مش side effect. اتأكد الإصلاح حياً: نفس نداءي الـ`curl` المتتاليين اللي كانوا بيفشلوا رجعوا ينجحوا فورًا (`accept()` بعد `create()` مباشرة من غير أي تأخير)، والاختبار الحي بقى بيعدّي. **تحديث (P0-9، 2026-08-13)**: لطلب مجدول "بعيد" (`deferred-dispatch.util.ts` — `computeDispatchDeferredUntil()`)، `OrderDispatchListener` بيجدول بث مؤجّل بدل ما ينادي `dispatchNextRound()` فورًا — الرد لسه بيرجع بسرعة برضو (مفيش انتظار لبث هيحصل بعدين)، بس مفيش `order_assignments` اتعملت وقت الرد. تفاصيل كاملة في `../matching/README.md` § تأجيل بث المطابقة.
- `POST /orders/:id/cancel`: بيتحقق إن الحالة الحالية لسه قابلة للإلغاء من العميل (قبل ما الفني يوصل)، وبيرفض أي محاولة إلغاء تانية على طلب اتلغى قبل كده.
- `GET /orders`, `GET /orders/:id`: للعميل صاحب الطلب بس.
- **`TechnicianOrderExecutionController`** (S5) — دورة عمل الفني بعد القبول: `POST /technician/orders/:id/depart|arrive|start|complete`، كل واحدة بتتحقق إن الطلب فعلاً بتاع الفني ده (`order.technicianId`) وإن الانتقال مسموح في الـ state machine قبل ما تسجّله، وبتحدّث عمود التوقيت المناسب (`technician_departed_at`... إلخ). **`GET /technician/orders/:id`** (كانت فجوة موثّقة في `apps/technician-app/README.md`، اتقفلت) — قراءة حالة طلب واحد، عشان الفني يقدر يسترجع مكانه في الدورة لو التطبيق اتقفل في النص.
- **`GET /technician/orders/active` — كانت فجوة موثّقة في `apps/technician-app/README.md`، اتقفلت**: بيرجّع أقرب طلب للفني الحالي في حالة نشطة (`accepted`/`technician_on_way`/`technician_arrived`/`in_progress`/`awaiting_quote_approval` — `ACTIVE_TECHNICIAN_ORDER_STATUSES` في `order-state-machine.ts`) أو `null` لو مفيش. انتظار قرار العميل على الشغل الإضافي لا يحرر الفني: الطلب وصل له مباشرة من `in_progress` ويرجع لها، والفني ما زال مالك الشغل. الفرق عن `GET /technician/orders/:id`: ده مش محتاج الفني يعرف الـ `id` مقدماً — التطبيق بيناديه لحظة الفتح عشان يقرر يفتح شاشة تنفيذ مباشرة (`OrdersService.findActiveForTechnician`).
- **بَقّة routing حقيقية خطيرة اتلقطت واتصلحت وقت بناء `GET /technician/orders/active`**: `MatchingModule` كان بيستورد `OrdersModule` بالكامل من غير أي سبب DI حقيقي (تفاصيل كاملة في `../matching/README.md`) — ده كان بيفرض ترتيب تحميل خلّى `GET /technician/orders/:id` (هنا) يتسجّل في Express **قبل** `GET /technician/orders/available` (في `matching`)، فـ NestJS كان بيطابق `:id` الأول ويرفض `"available"` كـ UUID غلط (`ParseUUIDPipe`). يعني **كل الفنيين مكانوش قادرين يشوفوا الطلبات المتاحة خالص** — بَقّة إنتاجية حقيقية، اتقدّمت من كوميت سابق في نفس الجلسة دي واتلقطت لما اختبار حي جديد فشل بـ"العرض ده مبقاش متاح" رغم الطلب سليم. اتصلحت بشيلين الاستيراد الزايد من `matching.module.ts` وترتيب `MatchingModule` قبل `OrdersModule` في `app.module.ts` (تعليق كامل في الملفين نفسهم).
- **رفع الصور (`order_media`)**: `POST /technician/orders/:id/media` (multipart, حقل `file` + `media_type`) و `GET /technician/orders/:id/media` (فني بس، `@Roles(TECHNICIAN)`) و **`GET /admin/orders/:id/media`** — الأدمن، نفس `OrderMediaService.listForOrder()` بس بصلاحية مختلفة. التخزين وراه واجهة `StorageService` (`common/storage/`) — كانت `LocalDiskStorageService` بس (تطوير)، دلوقتي `S3StorageService` حقيقي متاح جنبها (presigned URLs، `STORAGE_PROVIDER=s3` — تفاصيل كاملة في `common/storage/README.md`)، التبديل بـ env var واحد من غير أي تعديل كود.
- **`GET /orders/:id/media` (عميل، جديد — كانت فجوة موثّقة صراحة ضمن تقييم متقدم `docs/08` §9)**: كان فيه endpoint للأدمن وللفني بس مش للعميل صاحب الطلب — يعني العميل مكانش يقدر يشوف صور "قبل/بعد" طلبه أصلاً عشان يختار منها وقت التقييم المتقدم (`after_photo_media_ids` في `CreateRatingDto`). ownership check عبر `findOneOwnedOrThrow(user.sub, id)` قبل أي إرجاع — `404` لغير صاحب الطلب، نفس نمط بقية endpoints العميل. اتأكد حياً: عميل صاحب طلب فعلي بصور "بعد التنفيذ" شافها صح، عميل تاني ملوش علاقة بالطلب جاله `404`.
- **بَقّة حقيقية خطيرة اتلقطت واتصلحت وقت بناء عارض الصور في `apps/admin`**: `LocalDiskStorageService.save()` كان بيكتب الملف فعلياً على القرص ويرجّع رابط `/uploads/...`، بس **مفيش حاجة في `main.ts` كانت بتخدم المسار ده فوق HTTP خالص** — أي `file_url` راجع من `order_media` كان رابط ميت (404) من اليوم الأول، من غير ما حد يلاحظ لأن مفيش UI كان بيحاول يعرض الصور فعلياً. اتصلح بإضافة `app.useStaticAssets(resolve(storage.localDir), { prefix: '/uploads/' })` في `main.ts` (`NestExpressApplication` بدل `INestApplication` العادي) — بره الـ `globalPrefix` (`/api/v1`) عمداً، عشان يطابق الروابط اللي `LocalDiskStorageService` بيرجّعها من غير أي تعديل هناك. اتأكد الإصلاح حياً: صورة حقيقية اترفعت في اختبار حي سابق (`apps/technician-app`) كانت `404` قبل الإصلاح، بقت `200 image/png` بعده، والبايتات طابقت الملف الأصلي بالظبط (`diff` مباشر)، وظهرت فعلاً بصرياً في `apps/admin` (اتأكد بـ Playwright — صورتين حقيقيتين ظاهرتين بعنوانين "قبل الشغل"/"بعد الشغل" والتعليق الصح).
- اتعمله اختبار end-to-end فعلي كامل: إنشاء طلب → قبول فني → `depart`→`arrive`→`start` بالترتيب الصح، ومحاولة `complete` قبل الأوان اترفضت صح (`ORDR_003`) → رفع صورة PNG حقيقية اتكتبت فعلاً على القرص (اتأكد منها بـ `file` command) وسجل `order_media` صحيح → `complete` نجح → تاريخ الحالات الكامل (7 صفوف) مطابق تماماً لتسلسل القاموس.
- **`OrderTrackingGateway`** (S6, WebSocket namespace `/tracking`): الاتصال والانضمام يعيدان فحص المستخدم الحي والملكية وحالة الطلب. الحالات هي المصدر المشترك `ACTIVE_TECHNICIAN_ORDER_STATUSES` (وتشمل `awaiting_quote_approval`)؛ حالة منتهية ترفض join وتزيل الغرفة. location DTO يرفض string/NaN/Infinity/خارج النطاق/حقول زائدة، مع حد 10 تحديثات/10 ثوانٍ لكل socket. `tracking:joined` يعيد الحالة و`state_version` authoritative، وكل location يحمل `observed_at`.
- **`order:status_changed` بث لحظي (docs/08 §15)**: قبل البث يعيد gateway قراءة الطلب ويرفض الحدث المتأخر إذا لم تعد `new_status` هي الحالة الحالية، ويرسل `state_version`. تطبيقا العميل والفني لا يطبقان الحالة من الحدث مباشرة؛ الحدث يحفز REST reload للنسخة authoritative، لذلك duplicate/out-of-order/REST+WS echo لا يرجع الواجهة لحالة أقدم. reconnect يعيد join وفحص الملكية والحالة من جديد.
- اتعمله اختبار end-to-end فعلي كامل: إنشاء طلب → قبول فني → `depart`→`arrive`→`start` بالترتيب الصح، ومحاولة `complete` قبل الأوان اترفضت صح (`ORDR_003`) → رفع صورة PNG حقيقية اتكتبت فعلاً على القرص (اتأكد منها بـ `file` command) وسجل `order_media` صحيح → `complete` نجح → تاريخ الحالات الكامل (7 صفوف) مطابق تماماً لتسلسل القاموس → موقع الفني اتبعت عبر WebSocket حقيقي ووصل للعميل فوراً بالإحداثيات الصح.
- **حدث `order.status_changed`** (`common/events/order-status-changed.event.ts`): بيتصدر بعد كل commit لأي انتقال حالة عبر `transitionAsTechnician` (depart/arrive/start/complete) أو `cancel`، حامل `previousStatus`/`newStatus`/`customerId`/`technicianId` — نقطة واحدة يقدر أي موديول يشترك فيها (`notifications`/`chat` مستهلكين ليه) من غير ما يعرف تفاصيل الـ state machine. **ملحوظة كانت فجوة، اتقفلت**: انتقال `COMPLETED` بيحصل في `payments.service.ts` (`settleAndComplete()`، بتتنادى من `collectCash()`/`payWithWallet()`) مش هنا — الاتنين دلوقتي بيصدّروا نفس الحدث بره الـ transaction بعد التسوية، مطابق تماماً لنمط `transitionAsTechnician`. تفاصيل الاكتشاف والاختبار الحي في `../chat/README.md` (كان بيمنع قفل الشات الأوتوماتيكي 24 ساعة بعد الاكتمال).
- **`AdminOrdersController`** (`/admin/orders`, `@Roles(ADMIN)`, S9): `GET` (فلترة بـ `order_status` وفترة زمنية `from`/`to` + صفحات)، `GET /:id` (تفاصيل + تاريخ الحالات الكامل + `pricing_evaluation` — تفاصيل تحت)، `POST /:id/cancel` (سبب إلزامي، بيتحول لـ `cancelled_by_system` — بيحترم نفس الـ state machine، فمينفعش بعد ما الفني يقبل، لازم يعدّي من الشكوى)، `POST /:id/reassign` (تعيين فني معتمد مباشرة)، `PATCH /:id/adjust-price` (كانت فجوة موثّقة §13.7، اتقفلت — تفاصيل تحت).
- **`GET /admin/orders/:id`'s `pricing_evaluation` — كانت فجوة موثّقة صراحة (docs/08 §35: وضوح الإنتاجية/المدة المتوقعة للعمليات)، اتقفلت**: `service_pricing_evaluations` (جدول تدقيق موجود من زمان مع `PricingEngineService.evaluate()`، `computed_duration_days`/`computed_technicians`/`computed_assistants` مربوطين بـ`order_id` عبر `linkEvaluationToOrder()` وقت إنشاء الطلب) كان بيتسجّل فعليًا لأي طلب لخدمة `pricing_model=formula` بس محدش بيعرضه — لا في `apps/admin` ولا في أي endpoint. أضفنا `PricingEngineService.findEvaluationForOrder(orderId)` (أحدث صف لنفس الطلب) و`AdminOrdersController.getDetail()` بقى بيرجّع `pricing_evaluation: OrderPricingEvaluationResponseDto | null` (`null` لأي خدمة مش formula — مفيش تقييم اتسجل خالص وقتها). **متعمّد إنه أدمن بس** (نفس تعليق الكيان الأصلي "للتدقيق/المراجعة بس") — مش جزء من `OrderResponseDto` العميل/الفني العادي. اتأكد حي: خدمة formula تجريبية بمعادلة `literal` بحتة (مدة=2.5 يوم، صنايعية مطلوبين=2، مساعدين=1، سعر=450 ج.م) → طلب حقيقي عبر `POST /orders` → `estimated_price_cents` طابق 45000 بالظبط → `GET /admin/orders/:id` رجّعت `pricing_evaluation` بنفس القيم الثلاثة بالحرف → Playwright أكّد ظهورها في كارت "الإنتاجية والمدة المتوقعة" الجديد في `apps/admin/src/app/orders/[id]/page.tsx` (سكرين شوت). الخدمة التجريبية اتشالت (`DELETE /admin/services/:id`، soft-delete) بعد الاختبار.
- **`POST /:id/reassign` بيغطي طلب "التعيين القسري" في `docs/06` §2.2 بالكامل من غير أي كود إضافي (`docs/07` الجزء ب)**: راجعت الـ endpoint ده وقت بناء الجزء ب ولقيته بيحقق المطلوب بالحرف — الأدمن يقدر "يحشر" شغلانة لفني معيّن مباشرة (مش لازم يستنى المطابقة التلقائية)، و`OrderReassignedNotificationListener` (`../notifications/`) بيبعت للفني إشعار فوري ("الإدارة عيّنتلك طلب") لحظة التعيين. اتأكد حياً (فرق أ، امتداداً لاختبار `booking_mode`): فني حقيقي اترقّى واتأهّل، طلب `booking_mode=emergency` اتعيّن له، ونفّذ الدورة كاملة (`accept`→`depart`→`arrive`→`start`→`complete`→`collect-cash`) من غير أي مشكلة. **مفيش تعديل كود مطلوب هنا** — الميزة كانت جاهزة من قبل ما الرؤية الجديدة توصل، الجزء ده كان بس تحقق وتوثيق.
- **بَقّة حقيقية اتصلحت قبل الاختبار**: أول نسخة من `reassign` كانت بتحط الطلب `technician_assigned` وتسيب الفني "يقبل" بنفسه — لكن `matching.service.accept()` بيرفض أي طلب مش `searching_technician` أصلاً (وبيدوّر على صف `order_assignments` مش موجود للتعيين اليدوي)، يعني الفني المُعيَّن يدوياً ماكانش هيقدر يتحرك بالطلب أبداً. اتصلحت بخلي `reassign` يعدّي بنفس الانتقالين المعرّفين في `order-state-machine.ts` (`searching_technician→technician_assigned→accepted`) جوّه transaction واحدة، فالطلب يبقى `accepted` فوراً — منطقي لأن التعيين اليدوي معناه إن الأدمن أكّد مع الفني تليفونياً بالفعل.
- اتعمله اختبار end-to-end فعلي: أدمن لغى طلب لسه بيدوّر على فني بسبب واتوصل للعميل، إلغاء طلب بعد القبول اترفض صح (لازم شكوى)، تعيين فني يدوي لطلبين مختلفين بنجاح والفني قدر يكمّل الدورة كاملة (depart→arrive→start→complete) من غير أي مشكلة بعد التصحيح، تعيين لفني غير معتمد اترفض، وعميل حاول يوصل لمسارات الأدمن فاترفض 403.
- **فجوة كانت موثّقة، اتقفلت**: `order_assignments` القديمة من دورة matching الأصلية مكانتش بتتلغي صراحة وقت `reassign` — فني تاني كان مرشح أصلي كان يفضل شايف الطلب في `GET /technician/orders/available` لحد ما يحاول يقبله فيترفض بأمان وقتها. اتصلح بنفس النمط بالظبط المُستخدم في `matching.service.ts`'s `accept()`: `reassign()` دلوقتي بيلغي (`assignment_status = cancelled`) أي `order_assignments` لسه `sent`/`viewed` لنفس الطلب جوّه نفس الـ transaction. اتعمله اختبار حي مباشر: طلب باختبار بعروض `sent` لفنيين اتنين، أدمن عيّن فني تالت يدوياً عبر `POST /admin/orders/:id/reassign`، اتأكد بـ`psql` مباشر إن العرضين القديمين بقوا `cancelled` فوراً.
- **كود خصم اختياري** (`promo_code` في `CreateOrderDto`): بيتحقق ويتطبّق فعلياً عبر `PromotionsModule.PromoCodesService.validateAndApply()` جوّه نفس transaction إنشاء الطلب — الخصم بيتخصم من `total_amount_cents` ويتسجّل في `discount_amount_cents`/`promo_code_id`. تفاصيل الأمان الذرّي والاختبار في `../promotions/README.md`.
- **`PATCH /admin/orders/:id/adjust-price` — كانت فجوة موثّقة (§13.7)، اتقفلت**: صلاحية جديدة `orders.adjust_price` (`infra/migrations/0034_orders_adjust_price_permission.sql`، ممنوحة لـ `super_admin` و`ops_manager` — نفس منطق منح `orders.cancel`/`orders.reassign` في `0020`، عملية تشغيلية يومية مش قرار مالي بمستوى `finance`). أداة تصحيح يدوي خام لـ `total_amount_cents` (سبب إلزامي 5-500 حرف)، **مش** جزء من مسار `AWAITING_QUOTE_APPROVAL`/`order_items` الرسمي (لسه مش موجود، تحت). محظورة صراحة في حالتين: (1) `payment_status = paid` — بعد الدفع لازم استرداد/تحصيل إضافي حقيقي عبر `payments` مش تعديل رقم خام، (2) أي حالة نهائية (`completed`, أي `cancelled_*`, `expired`, `refunded`, `disputed`) — النزاع تحديداً له مساره الخاص عبر الشكاوى. بترفض كمان لو السعر الجديد نفس القديم بالظبط (409). اتعمله اختبار حي كامل: طلب تجريبي `searching_technician`/`unpaid` اتعدّل سعره بنجاح واتسجّل `order.price_adjusted_by_admin` في `audit_logs` بالقيمة القديمة/الجديدة والسبب؛ سبب قصير (أقل من 5 حروف) اترفض بالتحقق؛ نفس السعر اترفض 409؛ محاولة تعديل طلب مدفوع بالفعل اترفضت 409 برسالة توضح المسار الصح؛ محاولة تعديل طلب `cancelled_by_system` اترفضت 409؛ أدمن `support_agent` (مالوش `orders.adjust_price`) اترفض 403 من `PermissionsGuard`.
- **`POST /admin/orders/:id/assistants` — تعيين مساعد يدوي بعد تصعيد مطابقة المساعد التلقائية (ADR-0008، يمتد ADR-0007 §7 اللي أجّل الحل ده صراحة)**: صلاحية جديدة `orders.assign_assistant` (`infra/migrations/0076_manual_assistant_assignment.sql`، ممنوحة لـ `super_admin`/`ops_manager` نفس نمط `orders.adjust_price`). الأدمن بيختار أي فني `approved` من `/technicians` (مفيش قايمة "مساعدين متاحين" منفصلة)، محظور لو الأماكن اكتملت أو الفني هو قائد الطلب نفسه أو معيّن كمساعد بالفعل. `order_team_members` بقت تدعم `added_by_admin_user_id` (بديل لـ `added_by_technician_id` اللي بقى nullable) عشان الـaudit trail يفضل صادق — الأدمن مش فني. إشعار الفني عبر حدث جديد (`ORDER_ASSISTANT_ASSIGNED_MANUALLY_EVENT`، نفس اتفاقية الأحداث الموثّقة في `../assistant-matching/README.md`)، مش نداء مباشر لـ`NotificationsService`. `GET /admin/orders/:id/team-members` جديد كمان (كان endpoint موجود لـcustomer/technician بس، مش للأدمن). اتعمله اختبار حي كامل عبر curl مباشر: تعيين ناجح (audit log + إشعار + `added_by_admin_user_id` صح)، تعيين نفس الفني تاني اترفض 409، تعيين فني تالت بعد اكتمال الأماكن اترفض 409 "اكتملت بالفعل".
- **`address` في ردود تفاصيل الطلب — لخرائط التتبع/الملاحة في `apps/customer-app`/`apps/technician-app`**: `toOrderResponseDto()` بقى بياخد `address?: Address` اختياري ويضيف `address: {street_name, landmark, latitude, longitude}` للرد لو اتمرر. القوائم (`GET /orders`, `GET /admin/orders`) من غيره عمداً (تفادي join إضافي مش محتاجينه هناك) — مسارات تفاصيل الطلب الفردي بس بتمرره: `GET /orders/:id` (عميل، عنوانه هو بـ`findOwnedOrThrow`)، و`GET /technician/orders/:id`/`active`/`accept`/`depart`/`arrive`/`start`/`complete` (فني، عبر `AddressesService.findByIdOrThrow()` جديدة من غير فحص ملكية — الفني مش صاحب العنوان، بس وصوله له مضمون بمعرفة إن الطلب بتاعه أصلاً). تفاصيل كاملة في `../matching/README.md` (بَقّة حقيقية اتلقطت وقت بناء الميزة دي).
- ~~لسه من غير: `order_items` (إضافة قطع غيار/أجرة إضافية بموافقة العميل عبر مسار `AWAITING_QUOTE_APPROVAL` الرسمي — جزء من S7)~~ — **اتقفلت** (تفاصيل تحت).

## عرض السعر أثناء التنفيذ (`order_items` + `AWAITING_QUOTE_APPROVAL`) — كانت فجوة موثّقة صريحة (S7)، اتقفلت

الجدول (`order_items`) والحالة (`awaiting_quote_approval` في `order_status` ENUM) والانتقالات (`in_progress↔awaiting_quote_approval`) كانوا موجودين من `0007_orders.sql`/`order-state-machine.ts` من أول يوم — مفيش أي كود كان بيستخدمهم. `OrderItemsService` (جديد) هو أول مستهلك حقيقي.

- **النطاق متعمّد وضيق**: بس بنود إضافية بيقترحها الفني أثناء الشغل (`spare_part`/`extra_labor`/`addon` — `item_type='service'` مرفوض صراحة بالـ DTO). بند الخدمة الأساسي نفسه بره النطاق تماماً — بيتحدد من الكتالوج وقت إنشاء الطلب زي ما هو، مش له علاقة بالمسار ده. ربط إضافات الكتالوج (`service_addons`) بمسار إنشاء الطلب نفسه لسه فجوة منفصلة موثّقة في `../catalog/README.md`.
- **`POST /technician/orders/:id/quote-items`** (فني، بتاع الطلب بس): بياخد `items[]` (1-20 بند، `item_type`/`name_ar`/`quantity`/`unit_price_cents` إلزاميين)، بيحسب `total_price_cents = round(quantity × unit_price_cents)` سيرفر-سايد (مش من الكلاينت)، بيتطلب الطلب `in_progress` بالظبط، ويقفل الطلب ويعيد قراءة حالته جوّه نفس الـtransaction قبل إنشاء batch جديد. السياسة المقصودة: batches متتابعة مسموحة، لكن batch معلّق واحد فقط؛ السباق يرجع 409 نطاق واضح بدل إنشاء عرضين. `unit_price_cents=0` مسموح لبند مجاني مشروع (تعويض/حسن نية) ويظل موثقًا بلا obligation مالية.
- **`GET /technician/orders/:id/quote-items`** و **`GET /orders/:id/quote-items`** (فني/عميل، كل واحد بملكيته بس): قايمة كل البنود (المعلّقة والمعتمدة) للطلب.
- **`POST /orders/:id/quote-items/approve`** (عميل): بيوافق على **كل** البنود المعلّقة (`is_customer_approved=false`) دفعة واحدة، بيضيف مجموع `total_price_cents` بتاعهم لـ`orders.total_amount_cents` **مباشرة** (نفس العمود اللي `payments.service.ts` بيستخدمه وقت التسوية — **مفيش أي تعديل مطلوب في مسارات الدفع الموجودة أصلاً**، `collectCash()`/`payWithWallet()`/بوابة Paymob كلهم بيقروا `total_amount_cents` وقت التنفيذ)، وبيرجّع الطلب لـ`in_progress`. 409 واضح لو الطلب مش `awaiting_quote_approval` أو مفيش بنود معلّقة أصلاً.
- **`POST /orders/:id/quote-items/decline`** (عميل): الرفض transition محفوظ، لا `DELETE`: migration `0115` تضيف `proposal_status` (`pending`/`approved`/`declined`) ووقت/صاحب الرفض، لذلك يظل ما رآه العميل والمبلغ المقترح قابلين للتدقيق والنزاع. approve وdecline يقفلان الطلب ويعيدان قراءة الحالة؛ قرار نهائي واحد فقط يمكنه الفوز. الطلب يرجع `in_progress` و`total_amount_cents` لا يتغير عند الرفض.
- **إلغاء الطلب بالكامل وقت انتظار عرض السعر**: `order-state-machine.ts` كانت بتسمح بالفعل بـ `awaiting_quote_approval → cancelled_by_customer` بس `CUSTOMER_CANCELLABLE_STATUSES` (الـ set اللي `OrdersService.cancel()` بيتحقق منه) مكانتش شاملاها — يعني الانتقال المسموح في الـ state machine كان عملياً مستحيل الوصول له. اتضافت `AWAITING_QUOTE_APPROVAL` للـ set (فرق سطر واحد) عشان تستخدم `cancel()` الموجودة بالفعل (نفس منطق رسوم الإلغاء) بدل ما نكرر منطق إلغاء منفصل — العميل اللي مش عايز يدفع زيادة يقدر يلغي الطلب كله بدل ما يرفض البنود بس ويكمل بالنطاق الأساسي.
- **إشعارات**: العميل بياخد إشعار `awaiting_quote_approval` جديد ("عرض سعر جديد يستنى موافقتك") عبر نفس `OrderStatusNotificationListener` الموجود (مجرد إضافة مفتاح واحد لـ`CUSTOMER_MESSAGES`). الفني بياخد إشعار جديد لما العميل يرد (وافق/رفض) — الفرع ده بيتحقق من `previousStatus === AWAITING_QUOTE_APPROVAL && newStatus === IN_PROGRESS` في نفس الـ listener، والنص الفعلي (شامل عدد البنود والمبلغ) بييجي من `event.reason` اللي `OrderItemsService` بيبعته.
- **تحديث (docs/08 §21)**: `approve()` بقى فيها قفل `pessimistic_write` على الطلب جوّه نفس الـtransaction (كانت فجوة تزامن — موافقتين متزامنتين يقدروا يضيفوا نفس المبلغ مرتين)، وبنود نداء `propose()` الواحد بقى ليهم `batch_id` مشترك. لو الطلب مدفوع مسبقًا إلكترونيًا، الموافقة بتطلق محاولة تحصيل فورية للدلتا بوسيلة دفع محفوظة — تفاصيل كاملة في `../payments/README.md` قسم "طريقة دفع محفوظة".

## هيكل الحجز الجديد — `booking_mode` (فرد/اعتماد/طوارئ) — صُنّاع (`docs/06` §1، `docs/07` الجزء أ)

`orders.booking_mode` عمود جديد (enum `individual`/`team`/`emergency`، migration `0051`) — الوضع اللي العميل اختاره فعلياً في `BookingModeScreen` (أول شاشة في `apps/customer-app` بعد تسجيل الدخول، قبل ما يشوف أي كاتيجوري). **محور منفصل عمداً عن `order_type`** الموجود من زمان (`standard`/`scheduled`/`recurring`/`b2b`/`emergency`) — الاتنين بيتزامنوا بس في اتجاه واحد: لو `booking_mode='emergency'`، `create()` بتفرض `orderType=EMERGENCY` تلقائياً (بتتجاهل أي `order_type` مبعوت من الكلاينت في الحالة دي)، عشان أي كود قديم بيقرا `order_type` (كان موجود من زمان، **مش مستخدم فعلياً في أي منطق dispatch لحد دلوقتي** — اتأكد بـ grep وقت البناء) يفضل شغال صح من غير ما نلمسه.

- **التحقق وقت الإنشاء**: `create()` بترفض الطلب (`VAL_001`, 400) لو الخدمة المطلوبة (`catalog.services`) مش بتدعم الوضع المختار — `allows_individual`/`allows_team`/`allows_emergency` (الاتنين الجداد زي `allows_emergency` الموجود بالظبط، admin-editable عبر `/admin/services` الموجودة أصلاً). **قرار معماري لفجوة موثّقة** (docs/06 §5 #1: هل كاتيجوريز "اعتماد" منفصلة؟): **لأ** — نفس `services`/`service_categories` الموجودة، فلترة على مستوى الخدمة بس (`GET /services?booking_mode=individual|team|emergency` في `catalog` module). السبب: صاحب المشروع نفسه قال "مش فارق"، وده بيتجنب تكرار شجرة كتالوج كاملة.
- **`requested_technician_company_id`** (عمود جديد، FK لـ`technician_companies` الموجود من `0026`): "اعتماد" فقط — العميل يقدر يختار شركة/فريق بعينه من `GET /technician-companies` (endpoint عام جديد للعميل في `technicians` module، `TechnicianCompaniesService.listActiveCompanies()`/`findActiveCompanyOrThrow()`) بدل ما يسيب المطابقة تختار. تفضيل بس (نفس فلسفة `requested_technician_id` الموجود من `0046`) — **بقى مستهلك فعليًا في `matching.service.ts`** (كانت فجوة موثّقة، اتقفلت — تفاصيل كاملة في `../matching/README.md`). بيترفض `VAL_001` لو اتبعت مع `booking_mode` غير `team`، و`VAL_001`/404 لو الشركة مش موجودة أو مش نشطة.
- **اتعمله اختبار حي كامل** (curl ضد Postgres/Redis حقيقيين، مش mocks): خدمة `allows_individual=false, allows_team=true` رفضت طلب `booking_mode=individual` بوضوح ووافقت على `team`؛ تفعيل `allows_emergency` على نفس الخدمة وطلب `booking_mode=emergency` رجّع `order_type=emergency` تلقائياً (إثبات المزامنة)؛ فني اترقّى لمستوى `premium` وأنشأ شركة حقيقية عبر `POST /technician/company`؛ `GET /technician-companies` (عميل) عرضها صح (بدون `owner_user_id`/`commercial_registration_number`)؛ طلب `booking_mode=team` بـ`requested_technician_company_id` صحيح نجح وحفظ الـ id صح؛ نفس الـ id مع `booking_mode=emergency` اترفض بوضوح؛ id عشوائي غلط اترفض 404.

تفاصيل الأعمدة الجديدة على `services` (`allows_individual`/`allows_team`) والـ endpoint العام `GET /technician-companies` في `../catalog/README.md` و`../technicians/README.md` بالترتيب.
- اتعمله اختبار end-to-end حي كامل (4 سيناريوهات، مش mocks): **(1) الموافقة**: طلب حقيقي 30000 قرش وصل لـ`in_progress`، الفني اقترح بندين (3000 + 5000)، الطلب اتحول `awaiting_quote_approval`، العميل شافهم وواقف عليهم، الطلب رجع `in_progress` بـ`total_amount_cents=38000` بالظبط، الفني كمّل الطلب وحصّل كاش — **المبلغ المحصّل فعلياً كان 38000 بالظبط** من غير أي تعديل في `payments.service.ts`، اتأكد من DB مباشرة (`order_status_history.metadata` فيه لقطة البنود المعتمدة). **(2) الرفض**: طلب تاني، بند مقترح بـ20000، العميل رفض، الطلب رجع `in_progress` بـ`total_amount_cents=30000` (من غير تغيير)، `order_items` فاضي فعلاً (`DELETE` نجح)، اللقطة موجودة في `order_status_history.metadata`. **(3) الإلغاء الكامل وقت انتظار الموافقة**: طلب تالت، بند مقترح بـ50000، العميل اختار يلغي الطلب كله (`POST /orders/:id/cancel`) بدل ما يرد على العرض — نجح واتحول `cancelled_by_customer` مباشرة (نفس مسار الإلغاء العادي). **(4) حالات الرفض**: اقتراح بند على طلب `completed` بالفعل اترفض `409` واضح، موافقة على طلب من غير عرض سعر معلّق اترفضت `409`، `item_type='service'` اترفض بالتحقق (`400`)، وعميل حاول ينادي endpoint الفني اترفض `403`.
- **`apps/admin` بقى بيعرض البنود** (`GET /admin/orders/:id/quote-items` جديد + كارت "بنود عرض السعر" في `/orders/:id` — قراءة بس، مفيش إجراء موافقة/رفض من هناك، تفاصيل في `apps/admin/README.md`).
- ~~فجوة موثّقة متبقية: apps/customer-app/apps/technician-app (Flutter) مفيهمش شاشات لعرض السعر ده~~ — **اتقفلت**: `apps/technician-app` — زرار "اقترح عرض سعر (قطع غيار/أجرة إضافية)" في `order_execution_screen.dart` (بيظهر لما `order_status == in_progress`) بيفتح dialog لإضافة بند أو أكتر (نوع/اسم/كمية/سعر وحدة) وبيبعتهم لـ`POST .../quote-items`. `apps/customer-app` — كارت "عرض سعر جديد يستنى موافقتك" في `order_detail_screen.dart` (لما `order_status == awaiting_quote_approval`) بيعرض البنود المعلّقة وزراري "موافقة"/"رفض". `customerCancellableStatuses` في `models.dart` اتحدّثت تطابق `CUSTOMER_CANCELLABLE_STATUSES` (شاملة `awaiting_quote_approval` دلوقتي) عشان زرار "إلغاء الطلب" العادي يفضل شغال في نفس الوقت. **اتعمله اختبار حي كامل** (`apps/technician-app/test_live/quote_approval_live_test.dart`, نفس نمط `order_execution_live_test.dart`): فني قبل طلب حقيقي ونفّذه لحد `in_progress`، اقترح بند قطعة غيار (6000 قرش)، الطلب اتحول `awaiting_quote_approval`، العميل شافه عبر `GET /orders/:id/quote-items` ووافق، الطلب رجع `in_progress` بـ`total_amount_cents` زايد 6000 بالظبط، اكتمل الطلب وحصّل كاش — **المبلغ المحصّل فعلياً طابق الإجمالي الجديد بالظبط**. `flutter analyze`/`flutter test` عدّوا نضيف على التطبيقين (رندر الـ widget الفعلي والتفاعل معاه لسه بره النطاق القابل للاختبار هنا — نفس القيد الموثّق في `apps/customer-app/README.md`).

## `cancellation_reasons` + رسوم الإلغاء حسب نافذة زمنية — كانت فجوتين موثّقتين، اتقفلوا مع بعض

الجدول والعمود (`orders.cancellation_reason_id`) كانوا موجودين فعلاً من `0007_orders.sql` من أول يوم، بس الإلغاء كان بياخد نص حر بس، والفجوة التانية (`orders.cancellation_free_window_min` مزروع مش مستخدم) كانت مربوطة بنفس الميزة أصلاً، فاتقفلوا سوا بدل ما يتقفلوا لوحدهم بمعزل عن بعض.

- **`GET /cancellation-reasons?applies_to=`** (`@Public()`) — قايمة عامة تماماً، مفيش بيانات حساسة، بيستخدمها العميل/الفني كقايمة اختيار قبل الإلغاء (`applies_to` بيفرّق بينهم — الفني وسبب إلغاء العميل مش نفس القايمة).
- **`AdminCancellationReasonsController`** (`/admin/cancellation-reasons`, `cancellation_reasons.manage` — `infra/migrations/0039`، `super_admin`/`ops_manager`): `GET` كل الأسباب (نشطة وغير نشطة) لأي أدمن، `POST`/`PATCH` محتاجين الصلاحية. **مفيش `DELETE` حقيقي عمداً** — الأسباب دي مرجعية (`orders.cancellation_reason_id` FK)، `is_active=false` بس زي `service_zone_pricing`.
- **`POST /orders/:id/cancel` بقى بياخد `cancellation_reason_id` اختياري** (بالإضافة لـ`reason` النصي الحر، مش بدل منه — الاتنين ممكن يتحطوا مع بعض). لو `applies_to` بتاع السبب مش `customer` بيترفض `400` واضح.
- **حساب الرسوم**: لو السبب `charges_fee=true`، وعدد الدقايق من `placed_at` أكبر من `orders.cancellation_free_window_min` (افتراضي 5 دقايق)، الرسوم = `round(total_amount_cents × fee_percentage / 100)`. جوّه النافذة المجانية = صفر رسوم بغض النظر عن السبب. الرسوم بتتخصم فعلياً من محفظة العميل لمحفظة المنصة (`WalletsService.doubleEntry`, نوع `penalty`) **جوّه نفس transaction** إلغاء الطلب — نفس فلسفة `settleAndComplete` في `payments` ("الطلب اتلغى بس الرسوم متحصلتش" ميحصلش. `allowNegativeBalance:true` لأنها عقوبة مش دفع اختياري، نفس نمط تعويض الشكاوى في `../support/README.md`.
- **`affects_technician_score` مُخزّن بس مش بيأثر فعلياً على `quality_score`** — القاموس مالوش صيغة حساب محددة لتأثير سبب إلغاء معيّن على تقييم الفني، فمش هنخترعها (نفس مبدأ عدم اختراع سعر صرف نقاط الولاء في `../promotions/README.md`).
- اتعمله اختبار حي كامل: سبب "غيّرت رأيي" (عميل، رسوم 10%) وسبب "الفني مش قدر يوصل" (فني، من غير رسوم) اتعملوا، وظهروا فلترة صح في `GET /cancellation-reasons?applies_to=`. نافذة الإلغاء المجاني اتصغّرت مؤقتاً لصفر عبر الـ API، طلب حقيقي (30000 قرش) اتلغى بسبب فيه رسوم → **رسوم 3000 قرش بالظبط (10%) اتخصمت فعلياً من محفظة العميل الحقيقية** (اتأكد برصيد قبل/بعد مباشر بـ`psql`، وصف `wallet_transactions` نوعه `penalty` صح). رجّعت النافذة لـ5 دقايق الافتراضية، طلب تاني اتلغى فوراً (جوّه النافذة) بنفس السبب → رسوم = صفر بالظبط. محاولة استخدام سبب `applies_to=technician` لإلغاء عميل اترفضت `400` بوضوح. عميل عادي (مالوش `cancellation_reasons.manage`) اترفض 403 من إنشاء سبب جديد.
- **`apps/admin` — شاشة `/cancellation-reasons`، كانت فجوة مكتشفة (نفس أسلوب اكتشاف `/customers`/`/support`/`/payouts`/`/promotions`)، اتقفلت**: `AdminCancellationReasonsController` فوق كان كامل (`list`/`create`/`update`) من غير أي شاشة تستخدمه. **مفيش endpoints جديدة اتضافت**. فورم إنشاء (السبب عربي/إنجليزي، بيتاح لمين، بيحصّل رسوم + النسبة، بيأثر على تقييم الفني) + جدول بتبديل تفعيل/تعطيل (badge قابلة للنقر، نفس نمط `is_active` في الكتالوج). **اتعمله اختبار حي كامل**: سبب حقيقي بنسبة رسوم 20% اتعمل وظهر صح، تعطيله نجح — اتأكد `cancellation_reasons.charges_fee`/`fee_percentage`/`is_active` مباشرة من الـ DB.

## `OrderAutoCancelService` — إلغاء تلقائي لطلب `PENDING_PAYMENT` عالق فقط (`orders.payment_timeout_minutes`)

**تحديث جوهري — قرار عمل صريح من المالك (2026-08-19)**: الملف ده **كان** فيه مسار تاني بيلغي
طلبات `SEARCHING_TECHNICIAN` (مفيش فني قبلها لسه) بعد `orders.auto_cancel_after_minutes` (20 دقيقة
افتراضيًا) — ويسترد فلوسها تلقائيًا لو كانت مدفوعة مقدمًا (كارت/InstaPay). المالك بلّغ إن ده مش
المطلوب: طلب مفيش فني متاح ليه دلوقتي **لازم يفضل `searching_technician`**، مش يتلغى بصمت — الأدمن
هو اللي يتصرف يدويًا (تعيين قسري لفني، أو إلغاء إداري لو قرر كده فعلاً). المسار ده **اتشال بالكامل
من الكود** (مش عطّلناه بس) — `sweep()` بقت بتنادي `sweepPendingPayment()` بس. `orders.auto_cancel_after_minutes`
(الإعداد نفسه في `system_settings`) فضل موجود في القاعدة (مفيش migration حذف)، بس محدّش بيقراه
تاني — لو حد فكّر يرجّع الميزة دي مستقبلًا لازم قرار عمل صريح جديد من المالك الأول، مش رجوع تلقائي.

**الجزء الباقي فعّال زي ما هو (`PENDING_PAYMENT`، غير متعلق بتوفر فني خالص)**:

- **قرار تصميم متعمّد، مش سهو**: فحص دوري (`setInterval` كل 60 ثانية جوّه `OrderAutoCancelService`)، **مش** BullMQ delayed job لكل طلب زي `matching.service.ts`'s round timeouts. لو استخدمنا BullMQ هنا، "شبكة الأمان" كانت هتعتمد على **نفس** الـ Worker اللي عنده بَقّة موثّقة حقيقية (مبيرجعش يعالج وظايف جديدة بعد انقطاع Redis طويل — `../technicians/README.md`) — يعني هتقع بالظبط بنفس السبب اللي المفروض تحمي منه. الفحص الدوري بيعيد التقييم من Postgres مباشرة كل مرة، مفيش حالة متخزّنة في Redis ممكن "تعلق".
- **`sweepPendingPayment()`** — طلبات `PENDING_PAYMENT` قديمة (العميل بدأ دفع إلكتروني مسبق —
  كارت/InstaPay، ADR-0013 "PAY BEFORE DISPATCH" — بس مخلّصش) بتتلغى تلقائيًا بعد
  `orders.payment_timeout_minutes` (افتراضي 15 دقيقة، `infra/migrations/0100_pending_payment_timeout_setting.sql`).
  مفيش استرداد هنا — الدفع نفسه مكملش، مفيش فلوس اتاخدت أصلاً. كل طلب بيتلغى جوّه transaction
  منفصلة بقفل ذري (`pessimistic_write`).
- **تحديث (2026-08-19، بلاغ تاني)**: `MatchingService.cancelForNoTechnicians()` (كانت بتتنادى
  لما مفيش فنيين مؤهلين أصلاً أو الجولات خلصت من غير رد) كانت لسه شغالة كمسار منفصل — المالك بلّغ
  إنها بتعمل بالظبط نفس السلوك المرفوض فوق (إلغاء تلقائي صامت)، بس من زاوية تانية. **اتشالت
  بالكامل هي كمان** — تفاصيل كاملة في `matching/README.md`. `OrderAutoCancelService`.sweep()
  فاضل زي ما هو (مسؤول بس عن `sweepPendingPayment()`)، `matching.service.ts` بقى مسؤول عن الفرع
  التاني من نفس القرار.

**فجوة موثّقة صراحة، لسه قايمة**: استخدام `promo_code` وقت إنشاء الطلب بيزوّد `PromoCode.usedCount`
بس مفيش أي decrement/release ليه في أي مسار إلغاء بالكامل في النظام — مش بس هنا، ولا في `cancel()`
فوق ولا إلغاء الفني. قصور نظامي أوسع، محتاج قرار عمل منفصل (Business Decision Required).

اتعمله اختبار حي (`order-auto-cancel-pending-payment.spec.ts`، 3 اختبارات): طلب `PENDING_PAYMENT`
قديم يتلغى بلا استرداد (السلوك القديم فاضل زي ما هو)، وطلبين `SEARCHING_TECHNICIAN` قديمين جدًا
(واحد مدفوع بالكارت، واحد كاش غير مدفوع) — الاتنين **يفضلوا `searching_technician` بلا أي إلغاء أو
استرداد**، regression صريح للسلوك القديم اللي كان بيلغيهم.

## توزيع أدوار الفريق داخل الطلب الواحد (`order_team_members`) — صُنّاع (`docs/08` §5) — ✅ خلص

كانت فجوة موثّقة صراحة: `orders.technician_id` فرد واحد بس حتى لو الطلب `booking_mode='team'` — مفيش أي تسجيل لباقي أفراد الفريق اللي فعليًا هيشتغلوا في نفس الطلب. **مقياس "إنتاجية الفريق" المجمّع (البند التاني في نفس §5) اتأجل عمداً — قرار عمل محتاج تأكيد صريح من المالك (بيتحسب إزاي من إنتاجية الأفراد؟)، مش هيتخترع.**

- **`order_team_members`** (migration `0060`) — جدول إضافي بحت فوق `orders.technician_id` ("قائد الطلب"، بيفضل زي ما هو من غير أي تغيير). كل صف: `order_id` + `technician_id` + `role_label` (نص حر — مثلاً "سباك مساعد"، "حامل عدة" — مش enum مقفول عشان الأدوار الفعلية بتختلف حسب الصنعة والطلب ومفيش قايمة موحّدة في القاموس) + `added_by_technician_id`.
- **مين يقدر يضيف؟** الفني المسؤول عن الطلب (`orders.technician_id`) بس، وبس لأعضاء من **نفس الشركة/الفريق** (`technician_profiles.company_id` مطابق) — عشان منمنعش فني يحط أي حد عشوائي على طلب مش بتاعه. العضو المضاف **مبيوافقش** على الإضافة (زي "معاه مساعد؟" بالظبط — القرار لقائد الطلب مش للمضاف). مقصور على طلبات `booking_mode='team'` بس — طلب فردي مالوش معنى "توزيع فريق".
- **`POST/GET/DELETE /technician/orders/:id/team-members`** (`OrderTeamService`، جديد داخل `orders` مش موديول مستقل — امتداد مباشر لبيانات الطلب نفسه، نفس فلسفة `order-media.service.ts`). `GET /orders/:id/team-members` (العميل) — بيشوف مين هيشتغل معاه فعليًا، بعد فحص ملكية الطلب. **كان endpoint يتيم بالكامل من جانب `apps/customer-app` — مفيش كود Dart كان بينادي عليه خالص، اتقفلت في Phase B #12 (تفاصيل في `apps/customer-app/README.md`).**
- **اتعمله اختبار حي كامل**: فني (`TECH-000001`, مالك شركة) ضاف فني تاني (`TECH-000002`) لشركته عبر `POST /technician/company/staff` الموجود، طلب حقيقي اتعمل بـ`booking_mode=team` وانعيّن للفني الأول عبر `POST /admin/orders/:id/reassign` (تعيين قسري موجود من قبل). الفني الأول ضاف الفني التاني كعضو فريق بدور "سباك مساعد" — ظهر فورًا للعميل في `GET /orders/:id/team-members` بنفس الدور. محاولة إضافة نفس العضو تاني اترفضت `409`، محاولة الفني يضيف نفسه اترفضت `400`، محاولة إضافة `technician_id` وهمي غير موجود اترفضت بوضوح (`findByProfileIdOrThrow`)، حذف العضو نجح واختفى فورًا من القايمتين (الفني والعميل).

## تجنيد فريق ميداني ذاتي من الفني القائد — صُنّاع (`docs/08` §31، طلب مالك صريح 2026-08-20) — ✅ خلص

مختلف عمدًا عن "توزيع أدوار الفريق" فوق (اللي مقصورة على نفس الشركة/الفريق بس): هنا القائد بيجنّد
من **مجمع كل الفنيين المتاحين المؤهلين للصنعة**، مش بس شركته — بلا موافقة من المُضاف (نفس فلسفة
`addMember()`)، تجنيد فوري بضغطة واحدة.

- **`OrderTeamService.listRecruitCandidates(userId, orderId)`** — نفس نمط
  `TechniciansService.listForServiceBooking()` (فئة/خدمة معتمدة، `ADR-0018` §8)، بس بدون
  `technicianAvailabilityCondition` (التجنيد "تعال دلوقتي" مش حجز مستقبلي). فلاتر: `is_available`،
  `current_location IS NOT NULL`، مش مضاف بالفعل، مش القائد، **`currentLevel` ترتيبها ≤ ترتيب
  القائد** (`TechnicianLevel`: `NEW < VERIFIED < PROFESSIONAL < PREMIUM < TEAM_LEADER`، قرار
  مقصود للبساطة بدل `order_priority_weight` القابل للتعديل). مرتّبين بالمسافة، `LIMIT 30`.
- **`OrderTeamService.recruitMember(userId, orderId, technicianId, roleLabel?)`** — نفس فحوصات
  `listRecruitCandidates` تتأكد تاني وقت الإضافة الفعلية (القايمة ممكن تبقى قديمة)، `roleLabel`
  اختياري (افتراضي "عضو فريق"). بيطلق `ORDER_CREW_CHANGED_EVENT` بـ`addedByType='technician'`
  (قيمة جديدة على الحدث، افتراضي `'admin'` — نص إشعار مختلف: "قائد فريقك ضافك" بدل "الإدارة ضافتك").
- **`OrderTeamService.getShortageForOrder(orderId, requiredTechnicians)`** / الدالة المشتركة
  `computeCrewShortage()` (exported من `order-team.service.ts`) — نفس منطق `crewShortage` بتاع
  `AdminOrdersService.removeCrewMember()` (Script 4 §22-29)، اتستخرج لدالة واحدة مشتركة.
- **بَقّة حقيقية أخطر اتلقطت واتصلحت هنا**: `findOwnedByTechnicianOrThrow()`/
  `findActiveForTechnician()`/`findUpcomingConfirmedForTechnician()` كانوا بيفلتروا بـ
  `orders.technician_id = profile.id` **بس** — عضو فريق مُضاف (قائد أو أدمن، مش بس التجنيد الجديد)
  معندوش أي طريقة يشوف الطلب في تطبيقه خالص، حتى بمعرفته الـid مباشرة. **`OrdersService
  .findVisibleForTechnician(userId, orderId)`** جديدة (للقراءة بس — `GET :id`/`GET
  :id/team-members`، الطلب مرئي لو `technicianId=profile.id` **أو** فيه صف `order_team_members`
  بنفس `technicianId`) — أفعال التنفيذ (`depart`/`arrive`/`start`/`complete`/`cancel`) تفضل
  `findOwnedByTechnicianOrThrow` (القائد بس)، نفس فلسفة "عضو فريق عادي ميقدرش يلغي بنفسه".
  `OrdersService.listTeamAssignedForTechnician(userId)` جديدة كمان — "شغلي كعضو فريق".
- **Endpoints جديدة** (`technician/orders`): `GET team-assigned`، `GET :id/recruit-candidates`،
  `POST :id/recruit-candidates/:technicianId`. `GET :id` و`GET :id/team-members` بقوا
  `findVisibleForTechnician`. الرد بيحمل `team_shortage`/`team_members_needed` (للقائد على
  `booking_mode=team`) أو `team_leader_name` (لعضو فريق بيشوف تفاصيل طلب مضاف ليه).
- **اختبار حي مكتوب** (`order-team-recruiting.spec.ts`، بدون DB حي في بيئة الكتابة — نفس القيد
  الموثّق): فلترة المرشّحين (رتبة/توافر/فئة/موقع)، تجنيد ناجح + رفض (رتبة أعلى، مش متاح، نفسه،
  مكرر)، `getShortageForOrder`، ورؤية عضو الفريق للطلب (`findVisibleForTechnician`/
  `listTeamAssignedForTechnician`).
- **`apps/technician-app`**: كارت "الفريق ناقص" + زرار "دعوة/ضم فريق" (شاشة قايمة مرشّحين، دوس =
  تجنيد فوري) — تفاصيل في `apps/technician-app/README.md`.

## الضمان وإعادة الزيارة (`warranty_expires_at` + `parent_order_id`) — صُنّاع (`docs/08` §7) — ✅ خلص

**اكتشاف قبل أي كود**: `orders.warranty_expires_at` و`orders.parent_order_id` **موجودين بالفعل من migration 0007 الأولى** — نفس فئة "أعمدة راكدة" اتكشفت أكتر من مرة في السيشن ده (`customer_profiles.total_orders_count`، `technician_services.completed_count`، إلخ). **مفيش عمود جديد اتضاف في `orders` خالص** — بس تفعيل الموجود + `order_type` قيمة جديدة (`revisit`, migration `0061`).

- **`warranty_expires_at` بيتحسب فعليًا** في `PaymentsService.settleAndComplete()` (نقطة التسوية الوحيدة اللي الطلب بيوصل فيها `COMPLETED`) = `الآن + services.warranty_days` أيام — بس لو `warranty_days > 0`، وإلا بيفضل `null` (مش تاريخ في الماضي مضلّل). `computeSettlement()` بترجع `warrantyDays` كمان دلوقتي (كانت بترجّع بيانات العمولة بس) — نفس استعلام `catalogService.findServiceOrThrow()` الموجود أصلاً، صفر استعلام إضافي.
- **"إعادة زيارة"** — `POST /orders` بقى ياخد `original_order_id` اختياري (بيتترجم داخليًا لعمود `parent_order_id` الموجود، الاسم في الـ API أوضح دلالياً للعميل). لازم: بتاعة نفس العميل، `order_status=completed`، **نفس `service_id` ونفس `address_id` بالظبط**، و`warranty_expires_at` لسه في المستقبل — أي واحدة من دول غلط بترمي `400`/`404` واضح. `order_type` بيتفرض `revisit` تلقائيًا (بيتجاهل `dto.order_type`)، و`requested_technician_id` بيتفرض لنفس فني الطلب الأصلي (تفضيل مش ضمان، نفس فلسفة "إعادة الحجز" فوق). **مجانية بالكامل** (`estimated/inspection/total = 0`) — كود خصم أو إضافات كتالوج مع إعادة زيارة بيترفضوا بوضوح (`400`) بدل ما يتقبلوا ويعملوا حسابات غريبة على إجمالي صفر.
- **بَقّة حقيقية اتلقطت واتصلحت وقت الاختبار الحي — `payWithWallet` كانت هترفض أي طلب مجاني بالكامل**: `WalletsService.doubleEntry()` بترفض أي `amountCents <= 0` بتصميمها (حماية من قيود محفظة فاضية). لطلب `total_amount_cents=0` (إعادة زيارة)، ده كان معناه "الطلب اتقفل شغل (`work_completed`) بس مفيش طريقة يوصل `COMPLETED` خالص" — عالق للأبد لأن أي محاولة دفع (حتى لمبلغ صفر) كانت بترمي استثناء قبل ما توصل `settleAndComplete()`. اتصلحت بحماية نداء `doubleEntry` في `payWithWallet` بـ`if (lockedOrder.totalAmountCents > 0)` — لسه بيسجّل `Payment` وينادي `settleAndComplete()` عادي، بس من غير محاولة تحويل صفر جنيه. `collectCash` مكانتش متأثرة أصلاً (مفيش `doubleEntry` في مسارها المباشر، وتحويل أرباح الفني في `settleAndComplete` نفسه محمي بـ`if (technicianEarningCents > 0)` من زمان).
- **اتعمله اختبار حي كامل**: خدمة تجريبية `warranty_days=7`، طلب حقيقي اتنفّذ كامل (depart→arrive→start→complete→collect-cash) → `order_status=completed`, `warranty_expires_at` = بعد 7 أيام بالظبط. طلب "إعادة زيارة" حقيقي بنفس الخدمة/العنوان → `order_type=revisit`, `total_amount_cents=0`, `original_order_id` صح، و`requested_technician_id` (اتأكد من الداتابيز مباشرة) اتفرض لنفس الفني الأصلي تلقائيًا. محاولات رفض: عنوان مختلف اترفض، طلب أصلي وهمي اترفض `404`، طلب أصلي لسه مش مكتمل اترفض، كود خصم مع إعادة زيارة اترفض، وبعد ما ضمان الطلب الأصلي اتخلّى (`warranty_expires_at` في الماضي) الطلب الجديد اترفض بوضوح. إعادة الزيارة نفسها اتنفّذت كاملة ودُفعت **بالمحفظة (0 جنيه بالظبط)** — اتأكد الإصلاح شغال: وصلت `COMPLETED` بدل ما تعلق في `work_completed`.

## الجدولة المستقبلية/المتكررة (`recurring_order_templates`) — صُنّاع (`docs/08` §11) — ✅ خلص

كان `orders.order_type='recurring'` قيمة enum موجودة من أول يوم (migration `0002`) — مجرد تصنيف يدوي ممكن حد يحطه على طلب واحد عادي، **مفيش آلية توليد تكرار حقيقية**. بُني فوق §2 (Scheduler) و§7 (تفضيل فني) الجاهزين بالفعل، مش بديل عنهم.

- **`recurring_order_templates`** (migration `0064`) — قالب: خدمة/عنوان/وضع حجز/تفضيل فني (اختياري)/تردد (`weekly`/`monthly`/`yearly`)/`next_run_at`/`is_active`.
- **`RecurringOrdersService`** — **فحص دوري (`setInterval` كل دقيقة)، مش BullMQ repeatable job**، نفس فلسفة `OrderAutoCancelService` بالحرف (القرار الكامل موثّق في تعليق الكلاس نفسه) — تفادي الاعتماد على نفس الـ Worker اللي عنده بَقّة recovery موثّقة بعد انقطاع Redis طويل. `sweep()` بيلاقي القوالب المستحقة، وبيولّد طلب حقيقي **بنداء `OrdersService.create()` نفسها** (`order_type=recurring`, صفر تكرار منطق تسعير/تحقق)، وبيحرّك `next_run_at` قدّام (weekly=+7 أيام، monthly=+شهر تقويمي، yearly=+سنة).

  **بند 6 (docs/08 §19)، `payment_method` اختياري على القالب — كانت فجوة حقيقية، اتقفلت**: `generateFromTemplate()` كانت بتبني `CreateOrderDto` بدون `payment_method` خالص، يعني كل طلب متولّد من قالب متكرر كان non-prepaid دايمًا مهما كان تفضيل العميل — يكسر قاعدة الدفع-قبل-التوزيع (ADR-0013) لأي قالب متكرر. `recurring_order_templates.payment_method` عمود جديد (migration `0101`، `card`/`instapay` بس، `NULL`=زي زمان) بيتمرّر دلوقتي فعليًا لكل طلب متولّد. طلب متولّد بـ`payment_method` بيدخل `PENDING_PAYMENT` زي أي طلب عادي، وبيستفيد أوتوماتيك من `sweepPendingPayment()` (فوق) لو العميل ماكملش الدفع. **فجوة UX جديدة اتلقطت، موثّقة بره نطاق هذا الإصلاح**: مفيش إشعار push حقيقي للعميل لما طلب متولّد في الخلفية يدخل `PENDING_PAYMENT` — العميل مش هيعرف إن فيه طلب مستني دفع غير لو فتح التطبيق بنفسه بالصدفة قبل ما ينتهي `orders.payment_timeout_minutes` ويتلغي تلقائيًا. Business/UX Decision Required قبل بناء الإشعار ده (تفاصيل `docs/08` §19).

  **بَقّة حقيقية كانت هنا (موثّقة سابقًا كـ"تبسيط مقبول")، اتصلحت فعليًا (2026-08-13)**: `nextOccurrence()` كانت بتستخدم `Date.setMonth`/`setFullYear` الأصلي من غير أي معالجة لفيضان الأيام — قالب شهري مضبوط يوم 29/30/31 كان بيتزحلق تاريخه شهر بعد شهر (31 يناير + شهر بتحسبها JS كـ"31 فبراير" فتتدحرج لـ3 مارس، مش آخر يوم في فبراير). الإصلاح: `nextOccurrence()`/`lastDayOfUtcMonth()` جداد بيحسبوا الشهر/السنة الجديدة على "اليوم 1" الأول (مفيش فيضان ممكن)، وبعدين يعملوا `clamp` لليوم المطلوب على آخر يوم فعلي في الشهر الجديد (31 يناير + شهر → 28 فبراير بالظبط، مش 3 مارس). اتأكد بحسابات مباشرة (Node script) قبل الدمج: كل حالات الحافة (يناير 31، مارس 31، ديسمبر 31، فبراير في سنة كبيسة) بترجع التاريخ الصح.
- **تفضيل الفني مش ضمان** — نفس فلسفة "إعادة الحجز" بالحرف؛ لو الفني المفضّل مش متاح وقت التوليد، الطلب المولّد بيرجع للتوزيع العادي تلقائيًا (`matching.service.ts`)، مش بيتلغي أو يستنى. **مفيش قفل/حجز سلوت مسبق في الـ Scheduler هنا** — نطاق v1 بس، القالب بيولّد الطلب زي لو العميل حجزه بنفسه في اللحظة دي بالظبط.
- **فشل توليد طلب واحد ميعلّقش القالب للأبد** — `next_run_at` بيتحرّك قدّام حتى لو فشل الإنشاء لسبب مؤقت (بيتسجّل خطأ واضح باللوج)، عشان القالب ميفضلش يحاول يولّد نفس الموعد الفايت كل دقيقة للأبد.
- **`POST/GET/PATCH/DELETE /me/recurring-orders`** (العميل، `@Roles(CUSTOMER)`) — إنشاء (لازم `starts_at` في المستقبل)، قايمة، إيقاف/استئناف (`is_active` بس — تعديل باقي الحقول مش مدعوم عمداً، أبسط للعميل إنه يلغي وينشئ قالب جديد)، حذف ذاتي (soft delete).
- **اتعمله اختبار حي كامل**: قالب أسبوعي حقيقي اتعمل، الفحص الدوري ولّد طلب حقيقي فعلاً بعد ما الموعد استحق — `order_type=recurring` بالظبط، `next_run_at` اتحرّك +7 أيام بالظبط تلقائيًا. `starts_at` في الماضي اترفض بوضوح. إيقاف/استئناف نجحوا. تجربة تانية اتأكدت إن نفس القالب بيولّد طلب جديد تاني في الموعد التالي (مش بيتكرر نفس الطلب). حذف القالب نجح (soft delete، اختفى من القايمة).
- **`GET /admin/recurring-orders` — كانت فجوة موثّقة صراحة (docs/08 §32: وضوح الطلبات المتكررة)، اتقفلت**: مفيش أي مسار للأدمن يشوف القوالب المتكررة خالص رغم إنها بتولّد طلبات حقيقية كل موعد — لو قالب اتعطّل بصمت (الفشل فوق بيتسجّل باللوج بس، `next_run_at` بيفضل يتحرّك قدّام للأبد) محدش هيعرف غير بفتح الداتابيز مباشرة. أضفنا `RecurringOrdersService.listAllForAdmin(isActive, page, perPage)` (فلترة اختيارية بـ`is_active`، ترتيب بـ`next_run_at` تصاعديًا عشان أقرب موعد مستحق يبان الأول) و`AdminRecurringOrdersController` (`/admin/recurring-orders`, `@Roles(ADMIN)`, قراءة بس حاليًا) و`AdminRecurringTemplateResponseDto` (نفس شكل رد العميل زائد `customer_id`). اتأكد حي: قالب متكرر حقيقي (`monthly`, `individual`) اتعمل من عميل حقيقي → ظهر فورًا في `GET /admin/recurring-orders` بكل الحقول مطابقة، وفلتر `is_active=true`/`is_active=false` رجّع النتيجة الصح في الحالتين.
  - **بَقّة أمنية اتلقطت واتصلحت (مراجعة أمان شاملة 2026-08-13، P0-2)**: `@Roles(ADMIN)` بس كانت
    كافية لأي حساب أدمن يشوف القوالب المتكررة، من غير أي فحص صلاحية دقيقة. `recurring_orders.view`
    جديدة (`infra/migrations/0085`، ممنوحة افتراضيًا لـ`ops_manager`/`finance`) بقت
    `@RequirePermission` على الكنترولر. اختبار regression حي في
    `../admin/reports-and-recurring-orders-permission.spec.ts`.

## بَقّة حقيقية اتلقطت واتصلحت — `create()` مكانش بيتحقق من `booking_mode` أصلاً (بناء واجهة العميل، Phase C #16)

كانت الفجوة: `RecurringOrdersService.create()` كان بيقبل أي `booking_mode` (أو يسيبه فاضي فيرجع للـdefault `individual` من عمود الداتابيز) **من غير أي تحقق** إن الخدمة المطلوبة أصلاً بتدعم الوضع ده (`service.allowsIndividual`/`allowsTeam`/`allowsEmergency`) — بعكس `OrdersService.create()` العادي اللي بيرفض بوضوح (`VAL_001`, 400) من زمان. النتيجة: عميل يقدر ينشئ قالب متكرر بـ`booking_mode` غلط بالكامل، ياخد رد `200` ناجح، وبعدين `generateFromTemplate()` (السطور فوق) هتفشل بصمت **كل موعد للأبد** — `next_run_at` بيتحرك قدّام حتى لو الطلب الحقيقي فشل (تصميم متعمد لتفادي عالق يحاول نفس الموعد الفايت)، فمفيش أي إشارة للعميل إن القالب معطوب أصلاً، غير `last_generated_order_id` فاضل `null` للأبد لو حد فحص الداتابيز يدويًا.

- **الإصلاح**: نفس فحص `OrdersService.create()` بالحرف اتضاف في `RecurringOrdersService.create()` — بيرفض `VAL_001` فورًا وقت إنشاء القالب لو الوضع مش متاح، قبل ما القالب يتخزّن أصلاً.
- **اتعمله اختبار حي كامل**: محاولة إنشاء قالب بـ`booking_mode` افتراضي (`individual`) لخدمة `allows_individual=false` اترفضت `400` فورًا بنفس رسالة `OrdersService`. قالب صحيح بـ`booking_mode=team` (الوضع الوحيد المتاح للخدمة التجريبية) اتعمل ونجح، `next_run_at` اترجّع للماضي يدويًا لاختبار الفحص الدوري مباشرة (بدل انتظار أسبوع كامل) — الفحص الدوري (`setInterval` كل دقيقة) لقط القالب المستحق فعليًا وولّد طلب حقيقي (`order_type=recurring`, دخل توزيع الفنيين العادي) خلال دقيقة، و`next_run_at` اتحرّك +7 أيام تلقائيًا. بيانات الاختبار (القالب + الطلب المولّد) اتمسحت بعد التأكد.
- **جانب Customer App**: تفاصيل الشاشة الجديدة (`RecurringOrdersScreen`) في `apps/customer-app/README.md` — بتشتق `booking_mode` تلقائيًا من قدرات الخدمة المختارة (`CatalogService.defaultAllowedBookingMode`) بدل ما تسيب العميل يختار وضع ممكن يترفض، وبتفلتر قايمة الخدمات لإخفاء أي خدمة مالهاش أي وضع حجز متاح خالص.

## بَقّة حقيقية اتلقطت واتصلحت — `isNewCustomer` كان بيعتمد على عمود مؤجَّل (مراجعة booking flow الشاملة 2026-08-12)

`OrdersService.create()` (تطبيق كود خصم) و`PromotionsService.previewForOrder()` (المعاينة قبل الحجز)
كانوا بيحددوا "عميل جديد" (شرط أكواد الخصم `new_customers_only`) بـ`customerProfile.totalOrdersCount === 0`
— نفس فئة البَقّة الموثّقة بالفعل في `referrals/README.md` لـ`completed_orders_count`: العمود ده بيتحدّث
**async عبر BullMQ job** (`customer-stats.processor.ts`) بعد `emitAsync(ORDER_CREATED_EVENT)`، مش لحظيًا —
الـ`emitAsync` بيستنى بس إن الـjob يتجدول (`queue.add()`)، مش إن الـworker يعالجه فعليًا. الأثر: عميل
لسه لحظات من إنشاء أول طلب ليه ممكن يفضل يتحسب "جديد" غلط لو حاول يستخدم كود `new_customers_only`
تاني بسرعة قبل ما الـjob يتعالج.

**الإصلاح**: `CustomerProfilesService.isNewCustomer(customerProfileId)` جديدة — `COUNT(*)` مباشر على
`orders` بدل الاعتماد على العمود المؤجَّل، بنفس فلسفة `referrals.service.ts`'s `handleOrderCompleted()`
بالحرف. في `orders.service.ts` بيتحسب **قبل** الـtransaction (مش جواها) — لو اتحسب بعد ما الطلب الحالي
اتحفظ، الـ`COUNT(*)` كان هيشوف الطلب ده نفسه (نفس الـtransaction) ويحسب العميل غلط كـ"مش جديد" حتى
لأول طلب فعلي ليه.

**اتعمله اختبار حي كامل**: عميل جديد حقيقي اتسجّل، كودين خصم `new_customers_only` مختلفين اتعملوا.
الطلب الأول بكود التاني نجح وحسب خصم صح (`discount_amount_cents: 5000` من كود 50ج). الطلب التاني
**فورًا بعده** (نفس اللحظة تقريبًا) بكود التالت اترفض بوضوح `VAL_001` ("كود الخصم ده للعملاء الجداد
بس") — الإصلاح بيشتغل صح من غير أي اعتماد على توقيت الـBullMQ job خالص.

## ثغرة أمنية حقيقية اتكتشفت واتصلحت — `GET /technician/orders/:id/media` كان مفتوح لأي فني (مراجعة booking flow الشاملة 2026-08-12)

`TechnicianOrderExecutionController.listMedia()` كان بينادي `OrderMediaService.listForOrder(id)`
مباشرة من غير أي تحقق ملكية — أي فني عنده توكن صالح يقدر يشوف صور طلب مش بتاعه لو عرف/خمّن
الـid (Broken Object Level Authorization، OWASP API1). بعكس `listQuoteItems` جنب الميثود دي
بالظبط في نفس الـcontroller اللي بيتحقق فعليًا (`listForTechnician` في `order-items.service.ts`)
— نفس النمط اتطبّق دلوقتي على `OrderMediaService.listForTechnician(userId, orderId)` الجديدة.

**اختبار حي كامل بفنيين حقيقيين**: طلب حقيقي عنده صور (`ORD-2026-000019`، بتاع فني معيّن) — فني
تاني (مش صاحب الطلب) حاول يشوف صوره → اترفض `404` بوضوح ("الطلب غير موجود أو مش بتاعك"). نفس
الطلب مع صاحبه الحقيقي → نجح ورجّع الصورة صح.

**نفس الثغرة بالظبط اتلقطت واتصلحت كمان في `GET /technician/orders/:id/team-members`** — نفس
النمط تمامًا: `OrderTeamService.listForOrder()` عامة عمداً (بلا فحص ملكية داخلها، التصميم الأصلي
سليم)، بس `TechnicianOrderExecutionController.listTeamMembers()` كان بينادّيها من غير أي فحص
قبلها (بعكس نظيرتها في `orders.controller.ts` الخاصة بالعميل اللي بتنادي `findOneOwnedOrThrow`
الأول بشكل صحيح). الإصلاح: إضافة `findOwnedByTechnicianOrThrow(user.sub, id)` قبل النداء، نفس
النمط المستخدم في `getOne()` في نفس الـcontroller. اختبار حي بنفس الفنيين: الفني الغريب اترفض
`404`، صاحب الطلب الحقيقي نجح (رجّع قايمة فاضية — الطلب ده معندوش أعضاء فريق مضافين).

## `POST /technician/orders/:id/cancel` — الفني بيلغي طلب اتقبله بنفسه — كانت فجوة موثّقة، اتقفلت (بناء 2026-08-12)

`OrderStatus.CANCELLED_BY_TECHNICIAN` كانت حالة صالحة في `order-state-machine.ts` من زمان
(`ACCEPTED`/`TECHNICIAN_ON_WAY`/`TECHNICIAN_ARRIVED` كلهم بيسمحوا بالانتقال ليها) وموجودة في كل
أماكن القراءة (`technician-stats.processor.ts`'s `cancellation_rate`، `PRICE_LOCKED_STATUSES`)،
بس مفيش أي service method كانت بتحطها فعليًا — فني قَبِل طلب وحصل ظرف طارئ (عطل عربية، مرض مفاجئ)
مكانش يقدر يلغيه من التطبيق خالص. `OrdersService.technicianCancel()` جديدة (نفس نمط `cancel()`
الخاص بالعميل بالحرف) بتقفل الفجوة دي.

**القرارات المعمارية اللي اتاخدت (كانت المؤجّلة قبل كده)**:
- **الحالة النهائية**: الطلب بيتلغي نهائي (`CANCELLED_BY_TECHNICIAN: []` في الـstate machine —
  terminal زي إلغاء العميل/النظام بالظبط، **مش قرار جديد** — ده كان مكتوب في الـstate machine
  من الأول، بس محدش لاحظه صراحة). مش بيرجع `searching_technician` لإعادة توزيع صامتة — العميل
  بيتعرّف فورًا بإشعار واضح ("الفني اعتذر عن الطلب") ويقدر يحجز تاني بنفسه، أوضح من انتظار غير
  محدد المدة لإعادة توزيع قد متاخد وقت طويل لو مفيش فنيين متاحين.
- **الرسوم**: نفس آلية العميل بالظبط (سبب مُختار من `GET /cancellation-reasons?applies_to=technician`
  عليه `charges_fee`/`fee_percentage` اختياريين) — لو السبب عليه رسوم، بتتحصّل من **محفظة الفني
  نفسه** (مش من العميل) كتعويض للمنصة عن فني قبل الطلب وبعدين رجع فيه، نفس `WalletTxType.PENALTY`
  و`allowNegativeBalance:true` المستخدمين في رسوم إلغاء العميل. **بعكس العميل، مفيش نافذة زمنية
  مجانية هنا** — القاموس الأصلي مالوش مفهوم "فترة سماح" لإلغاء الفني بعد القبول.
- **`affects_technician_score`**: بيتسجّل بس (نفس فلسفة تسجيل العمود ده في إلغاء العميل — مالوش
  صيغة حساب محددة في القاموس، مش هنخترعها).
- **متاح بس قبل ما الشغل الفعلي يبدأ** (`accepted`/`technician_on_way`/`technician_arrived`) —
  بعد `in_progress` الإلغاء لازم يعدّي من الشكوى، نفس منطق العميل بالظبط ونفس رسالة الخطأ.

**اتعمله اختبار حي كامل**: طلب حقيقي (400ج) اتقبل من فني حقيقي، سبب إلغاء فني جديد اتعمل من
الأدمن (`charges_fee=true, fee_percentage=10`)، الإلغاء نجح → `order_status=cancelled_by_technician`،
`cancellation_fee_cents=4000` بالظبط، **رصيد محفظة الفني اتحرّك من 136400 لـ132400 بالظبط** (خصم
4000 صح)، والعميل استلم إشعار حقيقي ("الفني اعتذر عن الطلب"). محاولة الإلغاء على طلب `in_progress`
اترفضت `409` بنفس رسالة العميل. محاولة استخدام سبب `applies_to=customer` اترفضت `400` بوضوح
("سبب الإلغاء ده مش لإلغاء الفني"). **بونص غير متوقع**: الميزة دي كمان بتقفل فجوة تانية موثّقة
من سيشن سابقة — `technician_profiles.cancelled_orders_count` كان مجمّد على 0 للأبد لأن
`CANCELLED_BY_TECHNICIAN` مكانتش قابلة للوصول أصلاً؛ `TechnicianStatsRecalculationListener`
(موجودة من زمان، بتسمع `ORDER_STATUS_CHANGED_EVENT`) بقت تشتغل فعليًا دلوقتي — اتأكد حياً
(`cancelled_orders_count` زاد صح بعد كل عملية).

## سياسة إلغاء الفني الكاملة القابلة للإعداد (ADR-0006) — إعادة بناء `technicianCancel()` (بناء 2026-08-12)

القسم فوق ده وصف النسخة الأولى (hardcoded). المالك طلب تفصيلي: سياسة كاملة قابلة للإعداد — راجع
`docs/adr/0006-technician-cancellation-policy.md` للقرار المعماري الكامل قبل التنفيذ (البدائل
اللي اتقيّمت، تبرير كل قرار). الملخّص التقني:

- **إعدادات جديدة** (`settings`, `group_name='technician_cancellation'`, migration `0068`):
  `self_cancel_enabled` (مفتاح إيقاف عام)، `window_minutes_after_acceptance` (افتراضي 15 —
  الإلغاء الذاتي ممنوع بعدها، `ORDR_003` واضح يوجّه للدعم)، `min_minutes_before_scheduled_start`
  (افتراضي 60)، `auto_rematch_individual` (افتراضي `true` — فرد/طوارئ)، `auto_rematch_team_assigned`
  (افتراضي `false` — "اعتماد"/تعيين يدوي من الإدارة).
- **`order_status` قيمة جديدة `needs_technician_reselection`** (نفس migration، `ALTER TYPE ADD VALUE`).
  انتقالات جديدة في `order-state-machine.ts`: `ACCEPTED|TECHNICIAN_ON_WAY|TECHNICIAN_ARRIVED` بقوا
  يقدروا يروحوا `NEEDS_TECHNICIAN_RESELECTION` **أو** `SEARCHING_TECHNICIAN` مباشرة (مش بس
  `CANCELLED_BY_TECHNICIAN` زي قبل)، و`NEEDS_TECHNICIAN_RESELECTION` نفسها بتروح `SEARCHING_TECHNICIAN`
  (طلب إعادة مطابقة) أو `CANCELLED_BY_CUSTOMER`.
- **تحديد "هل ده تعيين يدوي/اعتماد؟" بلا عمود جديد**: `order.bookingMode === TEAM` **أو** وجود صف
  `order_status_history` بـ`change_source=admin` و`new_status=accepted` (بصمة `AdminOrdersService.reassign()`
  الموجودة من زمان) — استنتاج من بيانات موجودة بالفعل، مش schema إضافي.
  - لو صح **و** `auto_rematch_team_assigned=false` (الافتراضي) → `needs_technician_reselection`،
    إشعار عالي الأولوية للعميل (`order-status-notification.listener.ts`, رسالة جديدة)، مفيش
    إعادة توزيع صامتة.
  - غير كده (فرد/طوارئ عادي) → `searching_technician` + بث `ORDER_CREATED_EVENT` — **نفس الحدث
    اللي `OrderDispatchListener` الموجود بيسمعه من زمان لإنشاء طلب جديد**، فـ`dispatchNextRound()`
    بيشتغل تلقائيًا من غير أي كود مطابقة جديد. الفني اللي لغى مستبعد تلقائيًا (لسه ليه صف
    `order_assignments` من الجولة الأصلية — نفس شرط الاستبعاد الموجود أصلاً).
- **`POST /orders/:id/request-rematch` جديد** (عميل) — بيرجّع طلب `needs_technician_reselection`
  لـ`searching_technician` صراحة، `requested_technician_id` اختياري (تفضيل بس). **ملحوظة صريحة**:
  `dispatchNextRound()` بيحترم `order.requestedTechnicianId` بس في أول جولة (`nextRound === 1`) —
  الطلب هنا مش أول جولة أبدًا (رجع من إلغاء بعد جولات سابقة)، فالتفضيل بيتسجّل بس المطابقة العادية
  هي اللي هتشتغل فعليًا. قرار مقصود لتفادي لمس منطق الجولات المُختبر جيدًا في `matching.service.ts`.
- **السبب بقى إجباري دايمًا** (`cancellation_reason_id` مكانش، بقى) + عمود جديد
  `cancellation_reasons.requires_free_text` (نفس migration) — لو `true`، النص الحر (`reason`) بقى
  إجباري هو كمان (`VAL_001` واضح لو فاضي).
- **حدث audit كامل عبر `AuditLogService`** (مش عمود جديد) — `newValues` بيحمل `accepted_at`،
  `elapsed_minutes_since_acceptance`، `within_policy_window`، `booking_mode`، `rematch_behavior`.

**اتعمله اختبار حي لمسار الفرد/الأوتوماتيك بالكامل**: فني حقيقي قبل طلب `individual`. سبب
`requires_free_text=true` من غير نص اترفض `VAL_001`. طلب من غير `cancellation_reason_id` خالص
اترفض (بقى إجباري). الإلغاء الفعلي نجح (`cancellation_fee_cents` احتُسبت صح من نسبة السبب)،
`order_status` رجع `searching_technician` فورًا (مش `cancelled_by_technician` — تأكيد إن السلوك
الجديد اشتغل صح للفرد)، `ORDER_CREATED_EVENT` اشتغل تلقائيًا وأعاد محاولة المطابقة (الفني اللي
لغى اتستبعد صح، مفيش فنيين تانيين متاحين فالطلب اتلغى نظاميًا `ORDR_002` — سلوك متوقع تمامًا).
صف `audit_logs` تأكّد فيه كل الحقول المطلوبة صراحة. أرصدة المحافظ اترجعت للحالة الأصلية بعد الاختبار.

**لسه من غير — موثّق صراحة، مش سهو** (تفاصيل كاملة في `docs/10-integration-completion-tracker.md`):
مسار "اعتماد"/التعيين اليدوي (`needs_technician_reselection` + `request-rematch`) مكتوب ومبني بس
مش مُختبر حي لسه؛ `apps/technician-app`'s زرار الإلغاء لسه بيستخدم الـDTO القديم (السبب اختياري)؛
`apps/customer-app` مفيهوش أي UI لحالة `needs_technician_reselection` ولا زرار "أعد المطابقة"؛
قائد/مدير الفريق يلغي نيابة عن عضو تاني مؤجَّل عمدًا (محتاج قرار عمل، موثّق في ADR-0006 نفسه).

## ربط محرك التسعير الديناميكي بـ`POST /orders` — كانت أخطر فجوة تسعير موثّقة، اتقفلت (بناء 2026-08-12)

**بَقّة حقيقية خطيرة اتلقطت**: `create()` بينادي `catalogService.estimate(service.id, zone.id, undefined, bookingMode===EMERGENCY)` — وكانت `estimate()` مش عارفة `pricing_model=formula` خالص، فأي خدمة formula كانت بتتحجز بـ`estimated_price_cents=0`/`total_amount_cents=0` بصمت (السعر الأساسي الثابت لخدمة formula مسجّل عمدًا 0 لأنه مالوش معنى — السعر كله من المعادلة)، بينما `POST /services/:id/evaluate-price` (المسار المنفصل من Phase 1) كان بيحسب سعر حقيقي صح. التفاصيل الكاملة والقرارات المعمارية في `../pricing/README.md` (قسم "الربط بمسار إنشاء الطلب") — بس الخلاصة المباشرة هنا: `CreateOrderDto` بقى فيه `field_values?: Record<string, string|number|boolean>` اختياري بيتبعت مباشرة لـ`catalogService.estimate()`، اللي بقت تتفرّع لـ`PricingEngineService.evaluate()` لو الخدمة formula.

**اختبار حي**: خدمة formula حقيقية (مساحة×سعر_المتر + شروط) — `POST /orders` بـ`field_values` صحيحة أنتج `estimated_price_cents=2110`/`total_amount_cents=2110` مطابق تمامًا لناتج `evaluate-price`. `booking_mode=emergency` بنفس الحقول أنتج `surge_amount_cents=422`/`total_amount_cents=2532` (20% رسوم طوارئ فوق سعر المعادلة، صح). طلب من غير `field_values` أو بقيمة `dropdown` غير صالحة اترفض `400` واضح **قبل** أي كتابة في transaction — صفر صفوف orphan (اتأكد بعدّ `orders` قبل/بعد). `GET /promo-codes/:code/validate` (`PromotionsService.previewForOrder()`) اتصلحت بنفس المنطق بالحرف.

## `POST /orders/preview` — تفصيل السعر الكامل قبل التأكيد — كانت فجوة موثّقة صراحة، اتقفلت (بناء 2026-08-12)

**البَقّة/الفجوة اللي اتلقطت**: `apps/customer-app`'s `CreateOrderScreen` كانت بتعرض للعميل قبل التأكيد إما `service.basePriceCents` الثابت (نماذج `fixed`/`hourly`/`per_unit` — رقم من غير أي تعديل منطقة/مستوى فني/طوارئ، ممكن يختلف جذريًا عن المحصّل فعليًا)، أو (لخدمات `formula`) ناتج `POST /services/:id/evaluate-price` الخام (بلا رسوم فحص/طوارئ ولا إضافات ولا خصم). العميل ميكنش بيشوف رقم حقيقي متطابق مع اللي هيتحصّل قبل ما يضغط "تأكيد الطلب" أبدًا.

**الحل**: `OrdersService.previewPrice()` (وراءه `POST /orders/preview`، عميل مُسجّل، نفس صلاحيات `POST /orders`) — دالة **read-only بالكامل** (مفيش transaction ولا كتابة) بتكرر **بالحرف** نفس تسلسل تحديد المنطقة وحساب السعر في `create()` فوق (نفس `geoService.findZoneForPoint()`، نفس `catalogService.estimate()`، نفس حساب `addonsTotalCents`، نفس `promoCodesService.preview()`/خصم العمارة). أي تعديل مستقبلي في منطق تسعير `create()` **لازم يتعدّل هنا بالتوازي** — نفس الالتزام الموثّق سابقًا لـ`PromotionsService.previewForOrder()` (اللي بيعمل نفس الحاجة لكن لمعاينة كود الخصم بس، مش تفصيل السعر الكامل).

الرد (`PreviewOrderResponseDto`) بيرجّع كل بند سعر منفصل (`base_price_cents`, `inspection_fee_cents`, `min/max_price_cents` لـformula، `emergency_surcharge_cents`+`emergency_sla_minutes`، قايمة `addons` + إجماليها، `subtotal_before_discount_cents`، `discount_cents`+`discount_source`، `total_amount_cents` النهائي، و`estimated_duration_days` — الأخير مصدره الجديد `PriceEstimate.estimated_duration_days` في `catalog.service.ts` (مسحوب من `estimated_duration_days` الاختياري في `FinalPriceFormulaPayload` لخدمات formula بس، `null` لباقي النماذج).

**فجوة تانية أصغر اتقفلت في نفس البناء**: `catalog.controller.ts`'s `POST /services/:id/estimate` (endpoint عام أقدم، بياخد `zone_id` مباشرة بدل `address_id`) كان بيتجاهل `field_values` تمامًا حتى لو اتبعتت — أي معاينة عبره لخدمة formula كانت بترجع صفر. `EstimateQueryDto` بقى فيه `field_values?` (نفس نمط `ValidatePromoCodeQueryDto`: JSON string جوّه query لأن الـendpoint POST بلا body).

**اتأكد حي**: خدمة `fixed` (زون override 400 جنيه) — `POST /orders/preview` بـ`booking_mode=emergency` رجّع `total_amount_cents:48000` (400 + 20% رسوم طوارئ)، وطلب حقيقي بنفس المدخلات رجّع `total_amount_cents:48000` **مطابق تمامًا**. خدمة `formula` جديدة (مساحة×سعر_المتر + `estimated_duration_days` في المعادلة) — المعاينة رجّعت `total_amount_cents:1400`+`estimated_duration_days:2`، وطلب حقيقي بنفس المدخلات رجّع `1400` **مطابق تمامًا**. حالات سلبية: بلا عنوان → `400` واضح؛ بلا توكن → `401`؛ كود خصم وهمي → `400` برسالة "كود الخصم غير موجود" واضحة (مش رقم غامض). بيانات الاختبار (خدمتين + طلبين) اتعملها soft-delete بعد التأكيد.

## ربط الجدولة الحقيقية للفني بـ`POST /orders` — كانت فجوة موثّقة صراحة، اتقفلت (بناء 2026-08-12)

`TechnicianScheduleService.bookSlot()`/`releaseSlotForOrder()` (`../technicians/README.md`) كانوا primitives ذرّية جاهزة ومختبرة بلا أي caller خالص — العميل مكانش يقدر يحجز سلوت وقت محدد من جدول فني بعينه أصلاً. `CreateOrderDto.schedule_slot_id` اختياري جديد بيتحل داخل `create()`:

- **الفحص + الاشتقاق**: `findAvailableSlotOrThrow()` بترمي واضح لو السلوت مش موجود/محجوز بالفعل. `requestedTechnicianId`/`scheduledAt` بيتشتقوا تلقائيًا من السلوت — **بيتجاهلوا** أي `requested_technician_id`/`scheduled_at` تانيين اتبعتوا، إلا لو `requested_technician_id` بيتعارض صراحة مع فني السلوت (رفض واضح، مش اختيار صامت لأحدهم).
- **متبادل استبعادياً**: طوارئ (`bookingMode===EMERGENCY`) وإعادة الزيارة (`original_order_id` — بترجع لنفس الفني الأصلي تلقائيًا أصلاً) — الاتنين بيترفضوا بوضوح لو `schedule_slot_id` اتبعت معاهم.
- **الحجز الذرّي جوّه الـtransaction**: `bookSlot(slotId, order.id, manager)` بتتنادى فورًا بعد `manager.save(order)` — لو فشلت (سباق حقيقي، حد تاني حجز السلوت في نفس اللحظة)، رفض `409` بيترول باك الطلب كله (order + status history + addons + إلخ) مش يتعمل طلب بلا سلوت فعلي بيشاور عليه.
- **التحرير عند الإلغاء**: مركزي عبر `ScheduleSlotReleaseListener` (موديول `technicians`) بيسمع `ORDER_STATUS_CHANGED_EVENT` — مش نداء يدوي في `cancel()`/`technicianCancel()`/الإلغاء الإداري/التلقائي الأربعة، استماع واحد بيغطيهم كلهم.
- **اتعمله اختبار حي كامل** (تفاصيل الأرقام والاختبارات الكاملة في `../technicians/README.md`): فني حقيقي أنشأ سلوت، عميل حجز عليه، `requested_technician_id`/`scheduled_at` طابقوا السلوت بالظبط، `order_assignments` الجولة الأولى اتوزعت حصريًا على فني السلوت، إلغاء (عميل وفني) حرّر السلوت في الحالتين، سباق حقيقي بين عميلين على نفس السلوت — واحد بس نجح صفر orphan، وكل التوليفات المتعارضة (طوارئ/إعادة زيارة/فني مختلف) اترفضت بوضوح.

## إنتاجية الفريق وتقدير المدة على الطلب — صُنّاع (`docs/08` §5) — قرار عمل صريح من المالك، اتقفلت (بناء 2026-08-13)

**الفجوة**: `docs/08` §5 كانت موثّقة صراحة "اتأجل عمداً — مقياس الإنتاجية محتاج قرار عمل صريح من المالك، مش هيتخترع". المالك حدد القرار بمثال دقيق: الأدمن بيعرّف إنتاجية حقيقية للسوق (مثلاً 30 م²/يوم لفني+مساعد)، والنظام ياخد كمية العميل الفعلية ويحسب فريق/مدة منها — **مش يخترع رقم**. `CatalogService.estimateDuration(serviceId, standardDataId, requestedUnits, assignedTechnicians?, assignedAssistants?)` كانت موجودة ومختبرة بمعزل من زمان (Part C)، بتنفّذ بالحرف نفس الصيغة اللي المالك وصفها، بس **مفيش أي مكان في `POST /orders` بينادي عليها ولا بيخزّن نتيجتها على الطلب** — العميل يقدر يطلب `estimate-duration` بشكل منفصل بس النتيجة بترمي بمجرد ما يأكد الحجز.

**الحل (وصلة بس، مفيش محرك جديد)**: Migration `0074_order_team_productivity.sql` — `orders.standard_data_id`/`required_technicians`/`required_assistants`/`estimated_duration_days` (الأربعة NULL لو الخدمة مالهاش `ServiceStandardData` أصلاً أو العميل مبعتش `requested_units`). `CreateOrderDto` بقى فيه `standard_data_id?`/`requested_units?` اختياريين — لو الاتنين موجودين، `create()` بينادي `estimateDuration()` (نفس المحرك، بلا تكرار) ويخزّن النتيجة على صف الطلب وقت الإنشاء — **snapshot**، بالضبط زي أي حقل سعر تاني: لو الأدمن غيّر `productivityPerDay` بعدين، الطلبات القايمة بالفعل بتفضل بأرقامها الأصلية، وبس الطلبات الجديدة بتاخد الإعداد الجديد.

**اتأكد حي بمثال المالك بالحرف**: `ServiceStandardData` حقيقي — `productivityPerDay=30`, `minTechnicians=1`, `minAssistants=1`. طلب حقيقي بـ`requested_units=120` → `required_technicians=1`, `required_assistants=1`, `estimated_duration_days=4` (= ⌈120/30⌉) — مطابق 100% لمثال المالك. طلب بلا `standard_data_id`/`requested_units` → الأعمدة الأربعة `null` بدون أي خطأ (سلوك اختياري صح). بيانات الاختبار (خدمة + بيانات قياسية + طلب) اتعملها soft-delete/تنضيف بعد التأكيد.

**معروض في الواجهات**: `apps/admin` (صفحة تفاصيل الطلب، كارت "الإنتاجية والمدة المتوقعة" الموجود من Part B اتوسّع ليقرا من مصدر بيانات الطلب الجديد لو `pricing_evaluation` مش موجود) و`apps/customer-app` (`order_detail_screen.dart`، كارت جديد يظهر تحت وصف المشكلة لما `required_technicians`/`estimated_duration_days` موجودين). `create_order_screen.dart` بيبعت `standard_data_id`/`requested_units` من `_selectedStandardData`/حقل الكمية الموجودين بالفعل في شاشة إنشاء الطلب.

## مضاعف مستوى الفني قبل التأكيد — صُنّاع (`docs/08` §3) — قرار عمل صريح من المالك، اتقفلت (بناء 2026-08-13)

**الفجوة**: `CatalogService.estimate()` كانت بتاخد `technicianLevel` وتطبّق `ServiceLevelPricing.priceMultiplier` من زمان (Part A) — بس `OrdersService.create()`/`previewPrice()` **كانوا دايمًا بيبعتوا `technicianLevel=undefined`**، فمضاعف المستوى ماكانش بيتفعّل خالص في أي طلب حقيقي، والعميل ميكنش يشوف السعر المختلف باختلاف رتبة الفني قبل التأكيد أصلاً (نفس السعر بالظبط أيًا كان الفني المختار).

**الحل**: `create()`/`previewPrice()` بقوا يستحضروا مستوى الفني الفعلي **قبل** ما ينادوا `estimate()` — من `requested_technician_id` (لو اتبعت) أو من الفني المرتبط بـ`schedule_slot_id` (لو الحجز عبر سلوت)، وبيبعتوه كمعامل تالت لـ`estimate()`. `PreviewOrderResponseDto` رجّع `level_price_multiplier` جديد عشان العميل يشوفه صريح في `/orders/preview` قبل التأكيد. تفاصيل قايمة الفنيين المعروضة بمستوى/سعر نهائي لكل واحد في `../catalog/README.md`.

**اتأكد حي بمثال المالك بالحرف**: فني `premium` (مضاعف 1.20 في `ServiceLevelPricing`) على خدمة أساسها 1000 ج.م. — `/orders/preview` رجّع `level_price_multiplier:1.20`/`total_amount_cents:120000`، وطلب فعلي بنفس `requested_technician_id` رجّع `total_amount_cents:120000` **مطابق تمامًا** لما اتعرض في المعاينة — مفيش مفاجأة سعر بعد التأكيد. بيانات الاختبار اتعملها تنضيف بعد التأكيد.

**لسه محتاج تأكيد حي (نطاق متبقي موثّق صراحة، مش سهو)**: مسار استحضار المستوى عبر `schedule_slot_id` (بدل `requested_technician_id` مباشرة) اتبنى بنفس المنطق تمامًا بس ماتاختبرش حي في الجلسة دي. رسوم الطوارئ (`emergency_surcharge_cents`) جوّه `final_price_cents` في قايمة اختيار الفني (`../catalog/README.md`) اتبنت بس ماتاختبرتش حي بطلب `booking_mode=emergency` فعلي — الكود موجود ونفس مسار `isEmergency` المُختبر أصلاً في مسارات تانية، بس التوليفة "مستوى فني + طوارئ مع بعض في نفس الطلب" محتاجة اختبار حي مخصص قبل ما تتوثّق كـ"مؤكد".

## سياسة إلغاء الفني الكاملة — كانت hardcoded بسيطة، اتحوّلت لسياسة قابلة للإعداد بالكامل (بناء 2026-08-12)

**السياق**: `OrdersService.technicianCancel()` القديمة (سيشن سابقة) كانت: سبب اختياري + رسوم لو السبب عليها رسوم، وإلغاء **نهائي** دايمًا (`CANCELLED_BY_TECHNICIAN`، terminal). طلب المالك التفصيلي بالحرف: سياسة كاملة قابلة للإعداد (نافذة زمنية، تفعيل/تعطيل، سلوك مختلف حسب booking_mode)، سبب إجباري (كود+نص حر)، **الطلب ميتلغيش نهائي أبدًا** — إما إعادة مطابقة تلقائية أو استنى اختيار العميل، صلاحيات فريق/شركة، منع مزدوج/سباق، اختبارات سلبية وحية.

### الإعدادات (`group_name='cancellation'`, migration 0070) — صفر UI جديد، `/settings` بيعرضهم تلقائيًا
- `cancellation.technician_self_cancel_enabled` (افتراضي true) — تعطيل عام للميزة.
- `cancellation.window_minutes_after_acceptance` (افتراضي 10) — النافذة المسموحة بعد القبول.
- `cancellation.min_minutes_before_scheduled_start` (افتراضي 60) — لو الطلب مجدول (`scheduled_at`)، الإلغاء الذاتي بيتمنع لو اقتربنا من الموعد بأقل من ده، بغض النظر عن نافذة القبول.
- `cancellation.auto_rematch_enabled` (افتراضي true) — لطلبات "auto-match" (مش طوارئ، مش اختيار عميل صريح): إعادة مطابقة تلقائية ولا استنى اختيار العميل.
- ~~`cancellation.team_workers_can_self_cancel`~~ — **اتحذف استخدامها بالكامل (بَقّة حقيقية، 2026-08-21) — راجع "صلاحيات الفريق/الشركة" تحت.** الصف نفسه فضل موجود في `infra/migrations/0070_technician_cancellation_settings.sql` (migration موثّق ميتعدّلش)، بس مفيش كود بيقرأه دلوقتي — orphan غير ضار.
- **مفيش رقم عقوبة/تصعيد مالي مُخترَع** — الغرامة نفسها بتيجي من `cancellation_reasons.fee_percentage` الموجود أصلاً (لكل سبب). أي محرك تصعيد/سمعة مستقبلي (`docs/10` بند "penalty/escalation thresholds architecturally supported but not hardcoded") يقدر يُبنى فوق `technician_order_cancellations` مباشرة (كل إلغاء مسجّل بالكامل، عدّ نافذة زمنية = `COUNT(*) WHERE technician_id=... AND cancelled_at > now() - interval`) — مفيش سكيما إضافية لازمة دلوقتي.

### جدول `technician_order_cancellations` (migration 0069) — سجل مخصوص، منفصل عن `order_status_history`
بيسجّل لكل إلغاء فني: `technician_id`/`technician_user_id`، `cancellation_reason_id`، `reason_text`، `booking_mode`، `accepted_at`/`cancelled_at`/`elapsed_seconds_after_acceptance`، `within_policy_window`، `recovery_action` (`auto_rematch`|`manual_reselection_required`)، `fee_cents`. **`orders.cancelled_at`/`cancelled_by_user_id`/`cancellation_reason_id`/`cancellation_fee_cents` فضلوا زي ما هما (null)** — دول محجوزين للإلغاء النهائي الحقيقي (عميل/نظام) بس، إلغاء الفني هنا مش بيقفل الطلب.

### حالة طلب جديدة: `awaiting_technician_reselection` (migration 0068)
لما فني يلغي طلب كان العميل **اختاره بنفسه صراحة** (`requested_technician_id === technicianId` الحالي — يعني "إعادة الحجز" أو اختيار فني قبل الحجز، مش بث تلقائي)، أو لما `cancellation.auto_rematch_enabled=false`: الطلب بيتحول للحالة دي بدل الإلغاء أو إعادة المطابقة الصامتة. `orders.technician_id`/`requested_technician_id` بيتصفروا. العميل عنده مسارين:
- `POST /orders/:id/request-rematch` **بلا** `requested_technician_id` → بث تلقائي عادي.
- نفسه **مع** `requested_technician_id` → تفضيل فني بديل بعينه (نفس آلية "إعادة الحجز" — أول جولة بس، مش ضمان).

الحالتين بيرجّعوا الطلب لـ`searching_technician` ويصدّروا `ORDER_REMATCH_REQUESTED_EVENT` — `OrderRematchListener` (موديول `matching`، نفس نمط `OrderDispatchListener`/`ORDER_CREATED_EVENT` بالحرف) بينادي `MatchingService.dispatchNextRound()` الموجودة بالفعل، صفر منطق توزيع جديد. `AWAITING_TECHNICIAN_RESELECTION` مضافة لـ`CUSTOMER_CANCELLABLE_STATUSES` (العميل يقدر يلغي كله بدل ما يستمر) ولقايمة إلغاء الأدمن.

### سلوك استرجاع الطلب — 3 قرارات، كل واحد مبني على عمود/إعداد موجود فعلاً
1. **طوارئ** (`booking_mode=emergency`) — دايمًا `AUTO_REMATCH`، الطلب "ما يتلغيش" أبدًا (نفس كلام المالك بالحرف).
2. **العميل اختار الفني بنفسه** (`requested_technician_id === technicianId`) — دايمًا `MANUAL_RESELECTION_REQUIRED`، بغض النظر عن `auto_rematch_enabled` — مفيش تعيين صامت لفني تاني لاختيار العميل الصريح.
3. **غير كده (بث تلقائي عادي)** — حسب `cancellation.auto_rematch_enabled`.

**استبعاد الفني اللي لغى من إعادة المطابقة**: مجاني تمامًا — `findEligibleTechnicians()` في `matching.service.ts` أصلاً بتستبعد أي فني عنده صف `order_assignments` لنفس الطلب (من أي جولة سابقة)، وصف الفني اللي لغى فضل موجود (حالته `accepted`) — فمش هيترشح تاني لنفس الطلب أبدًا، حتى لو العميل طلب `requested_technician_id` بنفس الـid بالغلط (اتأكد حي).

### صلاحيات الفريق/الشركة — بَقّة حقيقية اتصلحت (اختبار مالك فعلي لتطبيق الفني، 2026-08-21)
**كانت**: `booking_mode=team` + الفني اللي بيحاول يلغي `team_role=worker` (مش `owner`/`manager`/`independent`) → 403 `"مينفعش تلغي الطلب ده بنفسك — لازم يعدّي من مدير الفريق"` عبر `canSelfCancelTeamOrder(technicianProfile.teamRole)`، إلا لو `cancellation.team_workers_can_self_cancel=true` (كان افتراضي false، بلا UI أدمن وبلا تغطية اختبارات).

**المشكلة**: `teamRole` هنا رتبة الفني الشخصية في شركته/فريقه **الدائم** (`technician_companies`، هرمية OWNER/MANAGER/SUPERVISOR/WORKER) — مفهوم منفصل تمامًا عن قيادة **هذا الطلب بالذات** (`orders.technician_id`، حسب معمارية §35/ADR-0021). النتيجة: فني هو **قائد الطلب الفعلي** (`findOwnedByTechnicianOrThrow()` أثبتت كده فعلاً — الاستعلام صراحة `WHERE technician_id = profile.id`، فمينفعش يوصل لهذا الفحص أصلاً غير القائد الحقيقي) كان بيترفض إلغاؤه الذاتي **لمجرد** إن رتبته الشخصية في شركة منفصلة "عادي" — قرار مالوش علاقة بصلاحيته على هذا الطلب. اتصلح اتلقط باختبار حي فعلي من المالك لتطبيق الفني: كارت "طاقم الطلب" بيعرض "لسه محدش انضاف" بلا زرار تجنيد (بَقّة تانية منفصلة، تحت)، وزرار الإلغاء بيقول "لازم مدير الفريق" رغم إن الفني هو القائد المُعيَّن فعليًا.

**الإصلاح**: حذف الفحص بالكامل من `getTechnicianCancellationPolicy()` و`technicianCancel()` — `findOwnedByTechnicianOrThrow()` نفسه هو الإثبات الوحيد المطلوب لقيادة الطلب (نفس مبدأ `OrderTeamService` بالحرف: القائد المُعيَّن على الطلب عنده صلاحية كاملة بلا بوابة رتبة شركة إضافية في أي مكان تاني بالنظام). `canSelfCancelTeamOrder()` و`TEAM_SELF_CANCEL_ALLOWED_ROLES` اتشالوا كـdead code. اختبار حي: `technician-team-order-leader-cancel.spec.ts` (قائد برتبة شركة `worker` منفصلة — `can_cancel: true` + إلغاء فعلي ناجح).

### النافذة الزمنية — `ORDR_004` (كود موجود من زمان، "انتهت مهلة الإلغاء المجاني"، أول استهلاك حقيقي هنا)
`evaluateCancellationWindow()` — دالة واحدة يستخدمها الفحص الاستشاري (`GET .../cancellation-policy`) والفرض الحقيقي (`POST .../cancel`) بالحرف، فمفيش احتمال يختلفوا. برّه النافذة → 403 واضح يوجّه للدعم، **مش** تعطيل صامت للزرار بس (لو الواجهة فشلت تخفيه لأي سبب، الباك-إند بيرفض بردو).

### `GET /technician/orders/:id/cancellation-policy` — استشاري بس
`{can_cancel, reason_if_not, window_expires_at}` — `apps/technician-app` بيستخدمه قبل ما يعرض زرار "إلغاء" أصلاً (مش hide-only في الواجهة، الباك-إند بيفرض نفس القرار وقت الإلغاء الفعلي بغض النظر عن الرد هنا).

### سبب إجباري + نص حر شرطي
`cancellation_reason_id` بقى **إجباري** في `CancelOrderAsTechnicianDto` (كان اختياري). `cancellation_reasons.requires_free_text` عمود جديد (migration 0069) — لو `true` (زي سبب "أخرى")، `reason` (نص حر) بقى إجباري، بيتفحص في الـservice (cross-field، مش قابل لـ`class-validator` عادي). نفس جدول `cancellation_reasons` الموجود أصلاً (`applies_to=technician`) — مفيش enum سبب موازي جديد.

### التركيبة الذرّية — مفيش إلغاء مزدوج ولا سباق
`technicianCancel()`/`requestRematch()` الاتنين بياخدوا `pessimistic_write` على صف الطلب **جوّه الـtransaction** (نفس نمط `matching.service.ts dispatchNextRound()`/`accept()` بالحرف) — أي نداء متزامن تاني (عميل بيلغي، فني بيلغي، مطابقة جولة تانية) بيستنى القفل، وبعدين بيعيد فحص الحالة الحقيقية بدل ما يفترض القديمة. لو الحالة اتغيّرت، `409` واضح بدل تعارض صامت.

### اتعمله اختبار حي كامل (curl ضد Postgres/Redis حقيقيين، مش mocks)
- **إلغاء عادي (auto-match، بث تلقائي)**: طلب `individual` بلا `requested_technician_id`، فني قبل، سبب برسوم 10% → الطلب رجع `searching_technician`، `technician_order_cancellations` صف صحيح بالكامل (`fee_cents=3000` من 30000)، محفظة الفني اتخصمت فعليًا (`wallet_transactions` نوع `penalty`)، إشعار عميل `in_app`+`push` (push فشل بأمان — مفيش جهاز مسجّل، failure_reason واضح في الجدول)، إشعار أدمن `ops_manager` عبر `NotificationRoutingService` وصل فعليًا (اتنين مستخدمين مختلفين). محدش فني تاني متاح في المنطقة التجريبية → وقتها `cancelForNoTechnicians()` كانت بتقفل الطلب `cancelled_by_system` — **السطر ده تاريخي بس** (قرار المالك 2026-08-19 شال السلوك ده بالكامل؛ دلوقتي الطلب فضل `searching_technician` + إشعار `order.no_technician_found`، تفاصيل في `matching/README.md`).
- **العميل اختار الفني بنفسه**: طلب بـ`requested_technician_id`، فني قبل، إلغاء بسبب من غير رسوم → `awaiting_technician_reselection` بالظبط (**مش** `searching_technician`) — الفرق الجوهري اتأكد حي.
- **`request-rematch`**: بلا فني → `searching_technician` فورًا. محاولة تانية على نفس الطلب (مبقاش `awaiting_technician_reselection`) → `409` واضح. مع `requested_technician_id` (حتى لو نفس الفني اللي لغى) → اتقبل، بس الفني ده اتستبعد تلقائيًا من الترشيح (نفس آلية `order_assignments`).
- **طوارئ**: طلب `emergency`، فني قبل، إلغاء → `searching_technician` فورًا (`recovery_action=auto_rematch` بغض النظر عن أي حاجة تانية) — اتأكد من صف `technician_order_cancellations` مباشرة.
- **نافذة زمنية**: `cancellation.window_minutes_after_acceptance=0` مؤقتًا → `GET .../cancellation-policy` رجّع `can_cancel:false` بالسبب الصح، و`POST .../cancel` الفعلي رفض `ORDR_004` **بنفس الرسالة بالظبط** — الاستشاري والفرض الحقيقي متطابقين.
- **سبب "أخرى" بلا نص حر** → `400` واضح "السبب ده محتاج توضيح نصي" قبل أي كتابة.
- **عضو فريق عادي (`team_role=worker`) على طلب `team`** → `GET .../cancellation-policy` رجّع `can_cancel:false`، و`POST .../cancel` رفض `403` بنفس الرسالة — الاتنين متطابقين. (فني `team_role=owner` على نفس الطلب اتأكد إنه يقدر يلغي عادي.)
- **بيانات الاختبار كلها اتنضّفت بعد التأكيد** (تعطيل أسباب الإلغاء التجريبية، رجوع الإعدادات لقيمها الافتراضية، رجوع أدوار/مستويات الفنيين التجريبيين).

### apps/technician-app
`OrderExecutionScreen` بيجيب السياسة (`fetchCancellationPolicy`) لما الحالة تكون `accepted`/`technician_on_way`/`technician_arrived` بس، وبيعرض زرار "إلغاء الطلب" بس لو `can_cancel:true` فعليًا. الضغط بيفتح `_CancelOrderDialog` (مرحلتين — اختيار سبب من قايمة حقيقية + نص حر شرطي، بعدين شاشة تأكيد نهائية صريحة — **مفيش إلغاء بضغطة واحدة**). بعد النجاح الطلب مبقاش بتاع الفني ده، فالشاشة بتقفل وترجع لقايمة الطلبات المتاحة.

### apps/customer-app
`OrderDetailScreen` بيعرض كارت تحذيري لما `order_status=awaiting_technician_reselection` — زرارين: "دوّرلي تلقائيًا" (`requestRematch` بلا فني) أو "اختار فني بديل" (بيفتح `TechnicianSelectionScreen` نفسها بوضع جديد `onManualSelect` — إعادة استخدام الشاشة الموجودة أصلاً من اختيار الفني قبل الحجز، مش شاشة موازية). **فجوة صغيرة موثّقة صراحة كانت هنا، اتقفلت (2026-08-12)**: قايمة الفنيين في `TechnicianSelectionScreen` (`GET /services/:id/technicians`) بقى ليها `exclude_technician_id` اختياري (`ListTechniciansForServiceDto` → `catalog.controller.ts` → `TechniciansService.listForServiceBooking()`, شرط SQL إضافي `AND ($4::uuid IS NULL OR tp.id != $4)`) — العميل دلوقتي مش بيشوف الفني اللي لغى بالذات في قايمة إعادة الاختيار من الأساس، مش بس بيتم استبعاده وقت المطابقة بعد اختياره بالغلط. `order.requestedTechnicianId` (مُتاح للعميل عبر `requested_technician_id` في `OrderResponseDto` دلوقتي) هو المصدر لقيمة الاستبعاد دي في `apps/customer-app`.

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.

## بَقّة مالية حقيقية اتلقطت واتصلحت — `cancel()` (إلغاء العميل) كان بيسيب طلب مدفوع مسبقًا بلا استرداد (docs/08 §20 بند 7)

**البَقّة**: `cancel()` (إلغاء العميل، مختلف عن `technicianCancel()` فوق) كان بيغيّر `orderStatus` لـ
`CANCELLED_BY_CUSTOMER` وياخد رسوم إلغاء (لو الطلب برّه النافذة المجانية) — بس صفر منطق استرداد لأي
`paymentStatus`. يعني عميل لغى بنفسه طلب دفعه مسبقًا (كارت/InstaPay، ADR-0013) — حتى قبل ما فني
يتعيّن أصلاً — كانت فلوسه تفضل معلّقة (`paymentStatus=PAID` على طلب ملغي نهائي) لحد ما أدمن يلاحظ
بنفسه ويرد يدويًا عبر `POST /admin/orders/:id/refund`. نفس السيناريو المالي بالظبط كان بيتصرف صح
تلقائيًا لو النظام (مش العميل) هو اللي لغى (`OrderAutoCancelService`، قسم فوق).

**الإصلاح**: بعد الـtransaction اللي بيغيّر الحالة (خارجها عمدًا — نداء بوابة دفع خارجي حقيقي
مايصحش يكون جوّه transaction ممكن ترجع لورا)، لو `paymentStatus === PAID`، بينادي
`PaymentsService.refundCancelledPrepaidOrder(order.id, reasonNotes, 'customer_cancel')` (تعميم
لدالة `refundSystemCancelledOrder()` القديمة — تفاصيل كاملة في `../payments/README.md`). فشل
الاسترداد بيتلقط ويتسجّل `audit log` (`order.refund_failed_needs_manual_review`) بس مايكسرش تجربة
إلغاء العميل — الطلب فضل ملغي صح حتى لو الاسترداد فشل واحتاج مراجعة يدوية (نفس فلسفة
`OrderAutoCancelService`). **صفر عكس أرباح فني هنا مهما كانت الحالة** — `CUSTOMER_CANCELLABLE_STATUSES`
مفيهاش ولا حالة ممكن يكون `settleAndComplete()` اتنفذ عليها (بتحصل بس عند `WORK_COMPLETED`)، فمفيش
قيد محفظة فني يحتاج عكس أصلاً. رسوم الإلغاء (لو السبب `chargesFee`) قيد `PENALTY` مستقل تمامًا،
واستمر يتحصّل زي ما هو من قبل — الاسترداد بيرجّع المبلغ **الكامل** اللي اتدفع للبوابة، الرسوم قيد
منفصل بيتحصّل من محفظة العميل الداخلية (تفاصيل "قرار عمل مطلوب" حول تحصيل الرسوم دي في
`../payments/README.md`).

**الاختبار**: `orders-cancel-prepaid-refund.spec.ts` (4 اختبارات حية ضد Postgres حقيقي) — إلغاء طلب
مدفوع في `SEARCHING_TECHNICIAN` وفي `ACCEPTED` (استرداد كامل في الحالتين، إثبات إن حالة التعيين
مبتأثرش)، إلغاء طلب كاش غير مدفوع (صفر محاولة استرداد — رجريشن)، ونداء `cancel()` مرتين على نفس
الطلب المدفوع (المحاولة التانية بترفض لأن الطلب نهائي، صف `refunds` واحد بس — idempotency).
`tsc --noEmit`/`nest build`/38 suite (205 اختبار) عدّوا نضيف. صفر migration مطلوبة.

## `GET /admin/orders/:id/financial-summary` — الملخص المالي لطلب واحد (docs/08 §20 بند 11)

**الفجوة**: `platform_commission_cents`/`technician_earning_cents` محسوبين ومخزّنين على `orders` من
زمان (docs/08 §20 بند 1) بس صفر endpoint كان بيرجّعهم لأي أدمن — `toOrderResponseDto()` كانت
ماسكاهمش خالص. مفيش كمان أي طريقة تعرف وسيلة دفع أو تاريخ استرداد طلب معيّن من غير تفتيش يدوي في
`/admin/wallets/:userId` (لو أصلاً عارف مين الفني/العميل).

**الحل — لمّ الموجود بس، صفر حساب جديد**: `PaymentsService.getFinancialSummaryForOrder(orderId)`
(جديدة، `payments.service.ts`) بترجّع `platformCommissionCents`/`technicianEarningCents`/
`cancellationFeeCents` من صف الطلب نفسه + كل صفوف `payments`/`refunds` المرتبطة (`WHERE order_id`)،
بلا أي حساب أو تعديل. اتنادت من `AdminOrdersController` مباشرة (`PaymentsService` مُصدَّرة من
`PaymentsModule` أصلاً، `OrdersModule` بيستوردها من زمان — صفر حقن جديد على مستوى الموديول). DTO
جديد `order-financial-summary-response.dto.ts` + نسخة مطابقة في `packages/shared-types`.

معروض في `apps/admin` (`/orders/:id`) كارت "الملخص المالي" جديد — عمولة/أرباح، قايمة الدفعات (وسيلة
+ حالة + مبلغ)، وقايمة الاستردادات (لو فيه). صفر تعديل على كارت البيانات الموجود — كارت مستقل جنبه.

**الاختبار**: `../payments/order-financial-summary.spec.ts` (اختبارين حيّين ضد Postgres حقيقي) —
طلب حقيقي بعمولة/أرباح/رسوم إلغاء + دفعة + استرداد جزئي، الدالة رجّعت كل رقم بالظبط زي ما اتخزّن؛
طلب غير موجود يترفض بوضوح (`ApiException`) بدل ما يرجّع بيانات فاضية بصمت. `tsc --noEmit`/
`nest build`/40 suite (209 اختبار) عدّوا نضيف. صفر migration مطلوبة (صفر عمود جديد، البيانات كانت
موجودة بالفعل).

## إثبات إنجاز الشغل إجباري — صورة `after_photo` واحدة قبل `WORK_COMPLETED` (docs/08 §20 بند 12، قرار مالك نهائي 2026-08-14)

**القرار**: عمداً بسيط لـMVP — صورة `after_photo` واحدة بس إجبارية قبل ما الفني يقدر يقفل الشغل،
لكل الطلبات بلا استثناء (صفر قواعد حسب نوع الخدمة/الطوارئ)، صفر توقيع عميل، صفر إعداد قابل للتهيئة،
صفر أثر رجعي على طلبات مكتملة بالفعل.

**التنفيذ**: `transitionAsTechnician()` (الدالة المشتركة وراء `depart`/`arrive`/`start`/`complete`
كلهم) — لو `to === WORK_COMPLETED` بس، بتعدّ صفوف `order_media` بـ`media_type='after_photo'`
للطلب وترفض (`ErrorCode.ORDR_005`, `400`) لو صفر. الفحص قبل أي `transaction` (قراءة بس)، وجوّه
الدالة المشتركة نفسها — يعني **مايتلفش** بنداء `POST /technician/orders/:id/complete` مباشرة (خارج
Flutter تمامًا). `OrderMedia` repo اتحقنت في `OrdersService` (`orders.module.ts` كانت مسجّلاها
أصلاً في `TypeOrmModule.forFeature`، صفر تغيير موديول).

**`apps/technician-app`**: تلميح استباقي في `order_execution_screen.dart` — لو الفعل الجاي
`complete` ومفيش `after_photo` مرفوع لسه، سطر تحذير برتقالي فوق زرار "إنهاء الشغل" مباشرة (نفس فحص
الباك-إند بالظبط). فشل النداء الفعلي (لو الفني تجاهل التلميح وضغط) بيظهر برسالة `ORDR_005` العربية
الواضحة عبر نفس `_error`/`ApiException.message` pathway الموجود بالفعل لكل فعل تاني — صفر plumbing
جديد. **صفر تعديل على زرار رفع الصور نفسه، صفر شاشة توقيع جديدة** — القرار رفضهم صراحة.

**الاختبار**: `technician-complete-proof-of-work.spec.ts` (4 اختبارات حية، بتنادي
`OrdersService.complete()` مباشرة — إثبات مباشر إن الفحص مايتلفش لو حد نادى الـendpoint بلا Flutter):
إنهاء بلا `after_photo` يترفض (`ORDR_005`، الطلب يفضل `in_progress`)؛ صورة واحدة كافية (`work_completed`
بنجاح)؛ أكتر من صورة مسموح (نفس النجاح، صفر حد أعلى)؛ `before_photo` بس مش كافي (النوع مهم مش أي
صورة). `tsc --noEmit`/`nest build`/41 suite (213 اختبار) عدّوا نضيف. `flutter analyze` نضيف (صفر
تحذير جديد). صفر migration (`order_media` موجودة من زمان، الفحص منطقي بس).

## زيارة فاشلة/عدم حضور (docs/08 §22 بند 3-6، 2026-08-15)

كانت فجوة موثّقة صراحة تمامًا: صفر آلية للفني يبلّغ إن الزيارة فشلت (العميل مش موجود، أو رفض شغل
ضروري لإتمام الطلب صح) — الخيارات المتاحة كانت بس `complete()` (كذب — الشغل ما اكتملش) أو
`technicianCancel()` (إلغاء نهائي بلا مراجعة). إعادة استخدام كاملة للبنية الموجودة — `DISPUTED`
(حالة موجودة أصلاً في state machine) + `Complaint` (`support` module، فئة `NO_SHOW` موجودة، فئة
جديدة `REQUIRED_WORK_REJECTED` اتضافت) + `PaymentsService.refundOrder()` الموجودة (استرداد جزئي/كامل)
— **صفر جدول جديد**.

**التدفق**: `OrdersService.reportFailedVisit(user, orderId, dto)` — الفني بيبلّغ من `TECHNICIAN_ARRIVED`
(no-show كلاسيكي) أو `IN_PROGRESS` (شغل ضروري اترفض)، الطلب يتحول `DISPUTED` (انتقالين جدد في
`order-state-machine.ts`: `TECHNICIAN_ARRIVED → DISPUTED`، `IN_PROGRESS → DISPUTED` كانت موجودة
أصلاً) وشكوى بتتسجّل تلقائيًا (`SupportService.fileComplaint()`، `filedByUserId`=الفني،
`againstUserId`=العميل تلقائيًا — نفس منطق `fileComplaint()` الموجود). فشل تسجيل الشكوى بيتلقّط
ويتسجّل بس **مايرجّعش** الطلب لحالته القديمة (الطلب فعلاً محتاج يتوقف الآن، نفس فلسفة
`attemptAdditionalWorkCharge`).

`OrdersService.resolveFailedVisit(adminUserId, orderId, dto)` — الأدمن بيحل بعد مراجعة حقيقية (مش
تصديق طرف واحد أعمى)، صلاحية مخصوصة `orders.resolve_failed_visit` (+ step-up MFA، نفس مستوى
`orders.adjust_price`، migration 0107):
- **`reschedule`**: `DISPUTED → ACCEPTED` (انتقال جديد) — نفس الطلب، نفس السعر، صفر تحصيل تاني.
  **تحديث (docs/08 §25.2، 2026-08-15)**: `new_slot_id` بقى إجباري فعليًا — الطلب بيرجع نشط
  بموعد جديد حقيقي متحقق من availability الفني (`TechnicianScheduleService`)، مش بنفس الموعد
  القديم بصمت. تفاصيل كاملة تحت "إعادة الجدولة".
- **`cancel_with_fee`**: طلب كاش (مفيش فلوس اتحصّلت أصلاً) → `DISPUTED → CANCELLED_BY_CUSTOMER`
  (انتقال جديد) **صفر رسوم دايمًا** — تعليمة صريحة، المنصة بتمتص تكلفة الفني للـMVP، صفر معاملة
  دفع وهمية. طلب مدفوع مسبقًا → رسوم زيارة (افتراضي `orders.no_show_visit_fee_cents`, migration
  0107, قابل للتعديل من الأدمن) بتتخصم من الاسترداد (مش تحصيل إضافي منفصل) عبر `refundOrder()`
  الموجودة بالفعل (بتدعم استرداد جزئي، وبتنقل الطلب `REFUNDED` تلقائيًا لو الاسترداد كامل). استرداد
  جزئي (فيه رسوم) بيسيب الطلب `DISPUTED` — `resolveFailedVisit()` بتقفله يدويًا لـ`CANCELLED_BY_CUSTOMER`
  بعدها.

**`apps/technician-app`**: زرار "زيارة فاشلة" (برتقالي، تحذيري) في `order_execution_screen.dart`
يظهر بس في `technician_arrived`/`in_progress` — dialog بسبب مقفول (3 خيارات) + توضيح نصي إجباري.
**`apps/admin`**: قسم "الطلب ده بلاغ زيارة فاشلة" في `orders/[id]/page.tsx` (يظهر بس لو
`order_status=disputed`) — زرار "إعادة جدولة" بيفتح slot picker حقيقي (docs/08 §25.2، تفاصيل تحت)،
أو فورم "العميل عايز يلغي" (رسوم اختيارية + ملاحظات مراجعة إجبارية).

**الاختبار**: `failed-visit-resolution.spec.ts` (9 اختبار حي) — no-show → reschedule بسلوت جديد
حقيقي محجوز والقديم بيترجع متاح (docs/08 §25.2)؛ رفض reschedule من غير `new_slot_id`؛ رفض
reschedule بسلوت فني تاني؛ required_work_rejected → شكوى بالتصنيف الصح؛ رفض تبليغ قبل الوصول
(`ACCEPTED`)؛ كاش cancel_with_fee صفر رسوم/صفر معاملة دفع؛ مدفوع مسبقًا استرداد جزئي (رسوم مخصومة،
الطلب يتلغي بعد الاسترداد)؛ مدفوع مسبقًا برسوم صفر (استرداد كامل، `REFUNDED` تلقائيًا)؛ رفض حل طلب
مش `DISPUTED`. 53 suite (290 اختبار) عدّوا كاملين، `tsc`/`nest build`/`flutter analyze` (التطبيقين)
نضيفين.

## بَقّة أمنية حقيقية اتلقطت واتصلحت: فجوة MFA/step-up على `adjustPrice` (تدقيق جاهزية الإطلاق النهائي، 2026-08-14)

`orders.adjust_price` مُدرجة في `MFA_REQUIRED_PERMISSIONS` (`../auth/mfa-policy.service.ts`) بس
`@RequireStepUp()` الفعلية متضافتش خالص على `PATCH /admin/orders/:id/adjust-price`
(`admin-orders.controller.ts`) — يعني `StepUpGuard` (global) كان no-op عليها، فجلسة أدمن مسروقة
كانت تقدر تعدّل سعر أي طلب من غير أي تأكيد Passkey حديث. اتصلحت بإضافة `@RequireStepUp()` (نفس فئة
البَقّة اللي اتصلحت في `wallets.adjust`/`payments.confirm_manual`/`settings.manage` مع بعض). تفاصيل
كاملة + الاختبار الجديد (`../auth/mfa-step-up-enforcement.spec.ts`) في
`../../../../docs/08-pricing-engine-and-platform-vision.md` قسم "تدقيق جاهزية الإطلاق النهائي — أمان".

## إعادة الجدولة (docs/08 §22 بند 9-12، 2026-08-15)

كانت فجوة موثّقة صراحة: `TechnicianScheduleService` بنيت للحجز الأولي بس (`bookSlot()`)، صفر طريقة
"تحويل سلوت محجوز لسلوت تاني" — العميل اللي عايز يغيّر ميعاد طلب مقبول كان مضطر يلغي ويطلب تاني
من الصفر (لو أصلاً الإلغاء متاح في حالته). `OrdersService.reschedule(userId, orderId, dto)` —
متاحة بس قبل ما الفني يبدأ يتحرّك فعليًا (`TECHNICIAN_ASSIGNED`/`ACCEPTED`، مش `TECHNICIAN_ON_WAY`
فما بعده)، ولازم السلوت الجديد يكون لنفس الفني المعيّن (تغيير الفني نفسه مسار مختلف تمامًا —
`request-rematch`). الحماية من الحجز المزدوج **صفر كود إضافي** — `TechnicianScheduleService
.rescheduleSlot()` بتستخدم `bookSlot()` الذرّية الموجودة من الأول (`UPDATE ... WHERE status=
'available'`) جوّه transaction واحدة مع تحرير السلوت القديم، فلو الجديد اتحجز من عميل تاني بينهم،
كل حاجة بترجع لورا (القديم يفضل زي ما هو، صفر خسارة موعد صامتة).

`ORDER_RESCHEDULED_EVENT` (حدث مخصوص، مش `ORDER_STATUS_CHANGED_EVENT` — إعادة الجدولة ماتغيّرش
`orderStatus` خالص) بيوصّل لإشعار عالي الوضوح للفني (in_app + push، `notifications/listeners/
order-rescheduled-notification.listener.ts`) — "العميل غيّر ميعاد الطلب". سجل التاريخ محفوظ في
`order_status_history` (صف بنفس الحالة قبل/بعد، `reason` فيه الموعد القديم والجديد).

**`apps/customer-app`**: زرار "غيّر ميعاد الزيارة" في `order_detail_screen.dart` (يظهر بس في
الحالتين المسموحتين) بيفتح قايمة السلوتات المتاحة للفني نفسه (`TechniciansRepository.fetchSchedule()`
الموجودة بالفعل من تدفق الحجز الأصلي).

اتأكد بـ5 اختبار حي جديد (`reschedule-and-address-warning.spec.ts`): إعادة جدولة ناجحة (القديم
يرجع متاح، الجديد يتحجز، `scheduledAt` يتحدّث)؛ رفض بعد `technician_on_way`؛ **تصادم حجز حقيقي**
(محاولتين متزامنتين `Promise.allSettled` على نفس السلوت — واحدة بس تنجح، اللي فشلت محتفظة بموعدها
الأصلي، صفر حجز مزدوج صامت)؛ رفض سلوت فني تاني؛ `AddressesService.hasActiveOrder()` (تفاصيل في
`../customers/README.md`). 47 suite / 259 اختبار API عدّوا كاملين، `tsc`/`nest build`/`flutter analyze`
نضيفين.

**تحديث (docs/08 §25.2، 2026-08-15)**: نفس `TechnicianScheduleService.rescheduleSlot()`/
`findAvailableSlotOrThrow()` هنا بالظبط بقوا مستخدمين كمان من `resolveFailedVisit(outcome=
reschedule)` (الطلب `DISPUTED` بعد no-show) — صفر تكرار منطق، صفر مسار جديد. `GET
/technicians/:id/schedule` (كانت `@Roles(CUSTOMER)` بس) بقت مفتوحة لـ`ADMIN` كمان
(`../technicians/README.md`) عشان الأدمن يقدر يختار سلوت حقيقي وقت حل نزاع.

## تسليم كاش بتأكيد الطرفين (docs/08 §22 بند 13-14، 2026-08-15)

كانت فجوة موثّقة صراحة: `PaymentsService.collectCash()` (الفني بس، تأكيد واحد، بيسوّي الطلب فورًا
عبر `settleAndComplete()`) مالوش أي طريقة العميل يأكّد بيها من جهته، ولا أي مسار لو الفني قال "مش
مستلم" رغم إن العميل بيقول إنه سلّم — كان أول اختلاف بينهم بيتقفل بمكالمة تليفون يدوية بره النظام
بالكامل. **`collectCash()` اتسابت زي ما هي من غير أي تعديل عمدًا** (مسار تسوية أساسي مختبر بكثافة،
تغيير فيه مخاطرة انحدار مش لازمة) — التأكيد الثنائي اتضاف إضافيًا بس:

- **`Order.customerCashConfirmedAt`** (migration 0108) — العميل يأكّد إنه سلّم الفلوس
  (`POST /orders/:id/confirm-cash-handover`، `OrdersService.confirmCashHandover()`). **مجرد تسجيل
  توقيت، صفر أثر على التسوية** — الطلب مايتسوّاش لوحده، ده إثبات حرفي إن تأكيد العميل وحده
  مايكفيش. Idempotent (بيتجاهل التكرار لو اتأكد قبل كده) — نفس متطلب حماية الضغط المزدوج/إعادة
  المحاولة الشبكية المعتاد في المشروع كله.
  **بَقّة حقيقية اتصلحت (docs/08 §37، 2026-08-21)**: الدالة دي ماكانتش بتفحص `orderStatus` خالص —
  عميل على طلب `pending_payment` (قبل التوزيع، صفر فني معيّن بالتصميم) كان يقدر يأكّد "تسليم كاش"
  ويسجّل تأكيد يتيم، والواجهة بترجّع "في انتظار تأكيد الفني" رغم مفيش فني أصلاً. بقى بيفحص نفس
  `CASH_HANDOVER_PAYABLE_STATUSES` اللي `reportCashNotReceived()` تحت بتفحصها بالحرف، زائد إعداد
  جديد `payments.cash_enabled` (`true` افتراضيًا، migration `0157`) — الأدمن يقدر يعطّل الكاش
  كوسيلة دفع كاملةً من `/settings` (`group_name='payments'`).
- **`Order.technicianCashNotReceivedAt`** — الفني يبلّغ "لم أستلم" (`POST /technician/orders/:id
  /cash-not-received`، `OrdersService.reportCashNotReceived()`). متاح بس على `WORK_COMPLETED`/
  `AWAITING_PAYMENT` (نفس `PAYABLE_ORDER_STATUSES` في `PaymentsService`). الطلب يتحول `DISPUTED`
  (نفس الحالة "تحت مراجعة الإدارة" اللي §22 بند 3-6 بيستخدمها لزيارة فاشلة — إعادة استخدام، مش
  حالة جديدة)، وشكوى بتتسجّل تلقائيًا (`SupportService.fileComplaint`، `ComplaintCategory.OTHER`)
  بعنوان بيفرّق بوضوح بين حالتين: "نزاع تسليم كاش" (لو العميل كان أكّد الاستلام قبل كده — تعارض
  مباشر) أو "الفني لم يستلم الكاش" العادي (لو العميل ماأكّدش خالص).
- **`PaymentsService.adminConfirmCashReceived()`** (جديد) — تسوية إدارية مباشرة، نفس بنية
  `collectCash()` بالحرف (صف `Payment` بعده `settleAndComplete()`) بس بشرط `DISPUTED` +
  `technicianCashNotReceivedAt IS NOT NULL` بدل `WORK_COMPLETED`/`AWAITING_PAYMENT`، وبمنطق
  `changedByRole='system'` (قرار أدمن، مش عميل/فني — نفس نمط `confirmInstaPayPayment()`).
- **`OrdersService.resolveCashHandoverDispute(adminUserId, orderId, dto)`** (`POST /admin/orders
  /:id/resolve-cash-dispute`، صلاحية `orders.resolve_cash_dispute` + step-up MFA إجباري — نفس
  مستوى حساسية `orders.resolve_failed_visit` بالحرف) — قرارين بس: `retry` (الطلب يرجع
  `WORK_COMPLETED`، الأعلام الاتنين بترجع `null`، الفني يقدر يحاول `collectCash()` تاني عادي) أو
  `confirm_received` (يفوّض لـ`adminConfirmCashReceived()` فوق — تسوية مالية فعلية). الشرط
  `technicianCashNotReceivedAt !== null` بيفرّق نزاع الكاش ده عن نزاع الزيارة الفاشلة
  (`resolveFailedVisit`) لما `order_status=disputed` — الاتنين بيستخدموا نفس الحالة، الأدمن بيعرف
  إنه في أي واحدة من `order-response.dto.ts`'s `technician_cash_not_received_at`.

**`apps/customer-app`**: زرار "دفعت الفلوس كاش للفني" في `order_detail_screen.dart` (جنب أزرار
الدفع الإلكتروني، بيختفي ويتبدل برسالة "في انتظار تأكيد الفني" بعد التأكيد). **`apps/technician-app`**:
زرار "لم أستلم الكاش" (أحمر، تحذيري) قرب زرار "حصّلت الكاش" — `Dialog` من خطوتين (وصف الموقف، بعدين
تأكيد صريح منفصل "متأكد إنك مستلمتش أي فلوس؟") عشان يمنع ضغطة غلط تعلّق الطلب من غير داعي.
**`apps/admin`**: قسم جديد في `orders/[id]/page.tsx` (يظهر بس لو `order_status=disputed &&
technician_cash_not_received_at != null`) بزرارين "إعادة محاولة التحصيل" و"تأكيد استلام الفلوس
فعليًا (إداري)".

اتأكد بـ6 اختبار حي (`cash-handover-confirmation.spec.ts`): تأكيد العميل وحده مايسوّيش الطلب +
idempotent؛ بلاغ الفني بلا تأكيد عميل سابق → `DISPUTED` + عنوان شكوى عادي؛ نفس البلاغ بعد تأكيد
العميل → عنوان شكوى فيه "نزاع تسليم كاش" (تعارض)؛ `retry` يرجّع الطلب `WORK_COMPLETED` والأعلام
`null`، وبعدها `collectCash()` عادي بينجح فعليًا (إثبات إن الرجوع حقيقي مش شكلي)؛ `confirm_received`
يقفل الطلب `completed` بـ`Payment.collectedByUserId` = الأدمن؛ رفض حل طلب مش نزاع كاش. 48 suite /
265 اختبار API عدّوا كاملين، `tsc`/`nest build`/`flutter analyze` (التطبيقين) نضيفين.

## بَقّتين تزامن حقيقيتين اتلقطوا واتصلحوا — "double admin edit" + سباق reschedule()/depart() (docs/08 §22 بند 31-32، 2026-08-15)

`resolveFailedVisit()`/`resolveCashHandoverDispute()` (بندين 3-6/13-14) كانوا بيقروا الطلب
بـ`findOne()` عادي من غير قفل، وبعدين يكتبوا نفس الـobject القديم جوّه transaction — لو أدمنين
حلّوا نفس النزاع بالتزامن، الكتابة اللي بتكمل تانية كانت بتغلب الأولى بحالتها القديمة كاملة (lost
update)، ممكن تسيب طلب مسوّى ماليًا عالق بحالة غلط. الإصلاح: `lockDisputedOrderForUpdate()` helper
جديد (`pessimistic_write` + إعادة تحقق `DISPUTED` تحت القفل نفسه) — نفس نمط `adminConfirmCashReceived()`/
`refundOrder()` الموجود بالفعل، مطبّق على الفروع التلاتة (`reschedule`, `cancel_with_fee` كاش،
`retry`) زائد إعادة تحقق مقفولة قصيرة قبل نداء `refundOrder()` الخارجي (بلا ما نمسك القفل عبر
الشبكة). نفس فئة البَقّة اتلقطت في `reschedule()` (بند 9-12) — كانت بتكتب `scheduledAt` فوق أي
تغيير حالة حصل بالتزامن (لو الفني `depart()` في نفس اللحظة، الطلب كان يرجع "accepted" كذب رغم إنه
فعليًا في الطريق) — نفس الإصلاح، `transitionAsTechnician()` (مسار pre-existing مختبر بكثافة)
اتسابت زي ما هي عمدًا (نفس منطق `collectCash()`).

**بَقّة تانية اتلقطت أثناء إصلاح الأولى**: بعد إضافة القفل، الكتابة الحقيقية بقت على نسخة `fresh`
مش على `order` (القيمة المرجّعة للكولر) — الـDB كانت بتتصلح صح بس القيمة المرجّعة فضلت قديمة (كشفتها
اختبارات موجودة فشلت فورًا). الإصلاح: رجوع لقراءة طازة من الـDB بدل الاعتماد على object قديم في
الذاكرة، نفس نمط `CONFIRM_RECEIVED` الموجود بالفعل.

اتأكد بـ7 اختبار حي جديد (`s22-cross-operation-concurrency.spec.ts`): "double admin edit" على نزاع
زيارة فاشلة (`reschedule` ضد `cancel_with_fee` بالتزامن) وعلى نزاع كاش (`retry` ضد `confirm_received`
بالتزامن) — واحد بس ينجح في الاتنين، صفر تسوية يتيمة؛ سباق `reschedule()` ضد `depart()`؛ 4 اختبار
IDOR حي (عميل/فني تاني مايقدروش يوصلوا لطلب مش بتاعهم عبر الـendpoints الجديدة). 49 suite / 274
اختبار API عدّوا كاملين، `tsc`/`nest build` نضيفين.

## Phase 7 — انتقالات الطلب تحت التزامن (Script 1 §52–57، 2026-08-17)

`transitionAsTechnician()` وراء `depart`/`arrive`/`start`/`complete`، وكذلك إلغاء العميل وإلغاء
الأدمن، تقفل صف الطلب وتعيد قراءة المالك والحالة المتوقعة وتتحقق من الـstate machine قبل الكتابة.
تغيير الحالة والطابع الزمني وصف `order_status_history` يلتزمون في transaction واحدة؛ الخاسر في
سباق من نفس الحالة يأخذ `409` ولا يكتب history كاذبة. إعادة تعيين الأدمن تستخدم نفس
`TechnicianAssignmentGuardService` التي يستخدمها قبول الفني، وتلتزم ذريًا مع مؤشر الفني والعروض.

التحقق الحي على PostgreSQL يغطي `complete × complete` (فائز واحد وصف history واحد)،
`reschedule × depart` (لا ارتداد لحالة قديمة)، و`accept × admin reassign` (لا اختلاف بين
`orders.technician_id` و`order_assignments`). قيد DB جزئي يضمن طلبًا نشطًا واحدًا لكل فني حتى
للكتّاب خارج هذه الخدمات.

مراجعة PR النهائية أضافت `awaiting_quote_approval` لنفس المورد المشترك. Migration `0121` تبني
المؤشر الأقوى أولًا ثم تستبدل مؤشر `0118`، لذلك تفشل بأمان على بيانات legacy متعارضة ولا تترك
القاعدة بلا حماية. اختبار PostgreSQL يثبت أن القبول وإعادة تعيين الأدمن والكتابة المباشرة كلها
ترفض فنيًا منتظرًا موافقة عرض سعر، مع بقاء الانتقال `in_progress ↔ awaiting_quote_approval` صالحًا.

## Call Center — إنشاء طلب نيابة عن عميل (Script 4 §33-37، 2026-08-18)

كانت فجوة موثّقة صراحة: `OrderSourceChannel.CALL_CENTER` قيمة enum موجودة من أول migration
(`0007_orders.sql`) بس `create()` كان بيحط `CUSTOMER_APP` دايمًا بلا شرط — عمود ميت، صفر مسار
حقيقي لموظف ينشئ طلب نيابة عن عميل.

**التصميم**: `OrdersService.create()` اتعدّل يقبل باراميتر خامس اختياري `callCenterContext?:
{adminUserId, meta}` — لو موجود، `source_channel='call_center'` و`created_by_admin_user_id`
(migration `0131`) بيتسجّلوا على الطلب + سطر تدقيق (`order.created_for_customer`) بعد الـtransaction
مباشرة. **نفس منطق التسعير/الجدولة/المطابقة بالحرف** — صفر duplicate logic، الفرق الوحيد هو مين
"العميل" اللي بيتحسب منه `customer_id` (userId العميل الحقيقي بيتمرر لـ`create()`، مش userId
الموظف — الطلب بيتملك للعميل دايمًا).

**صلاحية مخصصة (`orders.create_for_customer`)**: مش `orders.manage` عامة، ومش ممنوحة لـ`ops_manager`
زي `orders.cancel`/`orders.reassign` (دول عمليات على طلب موجود، ده إنشاء طلب جديد بهوية عميل
تانية بالكامل). ممنوحة بس لـ`super_admin` و`support_agent` (migration `0131`) — طبقًا لطلب
السبيسفيكيشن الأصلي الصريح: "صلاحية مخصصة، مش منح تلقائي لكل أدمن".

**`GET /admin/customers/:userId/addresses`** (endpoint إداري جديد، قراءة بس) — نفس
`AddressesService.findAllForUser()` اللي العميل نفسه بيستخدمه (`GET /addresses`)، صفر كتالوج
عناوين تاني منفصل. لازم قبل إنشاء الطلب (الموظف محتاج يعرف عناوين العميل المسجّلة).

**اختبار حي كامل** (curl مباشر ضد dev server حقيقي، JWT اتعمل sign بنفس `JWT_ACCESS_SECRET` بتاع
بيئة الـdev نفسها — بديل متناسب لتسجيل دخول WebAuthn MFA الحقيقي اللي مش قابل للأتمتة عبر curl):
- `super_admin` أنشأ طلب حقيقي لعميل حقيقي (`عميل حقيقي مع فني`) — `source_channel='call_center'`،
  `created_by_admin_user_id` صح، `customer_id` بيرجع لنفس العميل مش الموظف، سطر تدقيق كامل،
  **و`order_assignments` اتعمل فعليًا** (نفس محرك المطابقة الحقيقي اتنادى، مش مسار موازٍ).
- `ops_manager` (بدون الصلاحية المخصصة) اترفض بوضوح: "دورك الإداري مش مديك صلاحية العملية دي".
- بيانات الاختبار اتنضّفت بالكامل من الداتابيز بعد التحقق.

**apps/admin**: صفحة `/orders/create-for-customer` (بحث برقم موبايل → اختيار عميل → عناوينه
الحقيقية → فئة/خدمة من نفس الكتالوج → `field_values` JSON لخدمات formula كوضع متقدم ثانوي، نفس
فلسفة الـraw JSON escape hatch في Pricing Builder → تأكيد). زرار "إنشاء طلب نيابة عن عميل" في
`/orders` بيظهر بس لو `hasPermission('orders.create_for_customer')`. **فجوة موثّقة صراحة**: مش
اتعمل لها اختبار حي بمتصفح فعلي — نفس قيد WebAuthn MFA لتسجيل دخول الأدمن في بيئة الـsandbox.
`tsc`/`eslint`/`next build` كلهم نضاف، والـtypes متطابقة بالحرف مع رد الباك-إند الحقيقي المتحقق
منه بالـcurl فوق.

## إدارة طاقم الطلب من الأدمن (Crew Editing، Script 4 §22-29 و§38-41، 2026-08-18)

كانت فجوة موثّقة صراحة: `OrderTeamService.addMember()`/`removeMember()` مقصورين على الفني القائد
بس (`technician-leader-ownership-gated`، شوف السكشن فوق "توزيع أدوار الفريق داخل الطلب الواحد")،
و`AdminOrdersService.assignAssistant()` مقصور على شغل "مساعد" بس (ADR-0008). مفيش أي مسار أدمن
لإدارة أعضاء الطاقم العاديين (`member_type='team_member'`) — لو فني اعتذر آخر لحظة أو الطاقم ناقص،
مفيش أداة تشغيلية غير الدخول على الداتابيز يدويًا.

**صلاحية مخصصة (`orders.manage_crew`, migration `0132`)**: نفس نمط `orders.assign_assistant` في
`0076` — ممنوحة لـ`super_admin` **و**`ops_manager`، مش قاصرة على `super_admin` زي
`orders.create_for_customer` فوق. الفرق المتعمّد: دي عملية تشغيلية يومية (حل نقص طاقم، استبدال
عضو غاب)، مش قرار بهوية عميل زي إنشاء طلب.

**فرق متعمّد عن `OrderTeamService` (الفني القائد)**: `validateCrewCandidateOrThrow` في
`AdminOrdersService` **مبيتحققش من تطابق الشركة** (`company_id`) بين الفني الجديد وقائد الطلب —
بعكس `OrderTeamService.addMember()` اللي بيرفض صراحة أي فني من شركة مختلفة. القرار: الأدمن أداة
تشغيلية استثنائية (حل نقص طاقم بأي فني معتمد متاح)، مش مقيّد بحدود تنظيمية الفريق العادي. باقي
الشروط نفسها: `booking_mode='team'` بس، الفني لازم `verification_status='approved'`، مش قائد
الطلب بالفعل، مش عضو مضاف بالفعل، وتحت `MAX_TEAM_MEMBERS_PER_ORDER` (15، نفس الحد المستخدم في
`OrderTeamService`، بقى `export`ed من هناك بدل تكراره).

**3 endpoints جديدة** تحت `orders.manage_crew`:
- `POST /admin/orders/:id/team-members` — إضافة عضو (`technician_id` + `role_label`).
- `POST /admin/orders/:id/team-members/:memberId/remove` — إزالة، `reason` إلزامي (5-500 حرف).
  بيرجع `{ crewShortage: boolean }` — مؤشر عددي بسيط (`remaining + 1 < order.required_technicians`،
  الـ`+1` بيمثّل قائد الطلب اللي مش صف في `order_team_members`) لتحذير الأدمن فورًا لو العدد بقى
  أقل من `required_technicians` (snapshot محرك الإنتاجية وقت الحجز) — **صفر تطابق أدوار دقيق**،
  مفيش تعقّب لأي دور تحديدًا نقص، العدد الكلي بس.
- `POST /admin/orders/:id/team-members/:memberId/replace` — استبدال ذرّي: `new_technician_id` +
  `reason` إلزاميين، `role_label` اختياري (لو مش مبعوت بياخد دور العضو القديم). الاستبدال بالكامل
  جوّه `dataSource.transaction()` واحدة (حذف القديم + إضافة الجديد سوا) — صفر نافذة زمنية يفضل
  فيها الطلب من غير العضو ده خالص. **حماية سباق**: العضو القديم بيتقرا تاني *جوّه* الترانزاكشن
  (مش بس الاعتماد على الفحص المبدئي فوقها) عشان لو حد شاله بالتوازي بين الفحص والتنفيذ.

**إشعارات**: حدث عام جديد `OrderCrewChangedEvent` (`order.crew_changed`، `added`/`removed`/`replaced`)
— بعكس `OrderAssistantAssignedManuallyEvent` المقصور على "مساعد" بس. الفرق المتعمّد: العضو المُضاف
**ميوافقش** على الإضافة (زي "معاه مساعد؟" — القرار للفني القائد أو الأدمن، مش للمضاف)، فالحدث ده
إشعار بس، صفر انتظار قرار. `OrderCrewChangedNotificationListener` بيبعت للفني المتأثر (المضاف
و/أو المشال حسب نوع التغيير).

**كل عملية بتسجّل `audit_logs`** (`order.crew_member_added`/`_removed`/`_replaced`) بـ
`oldValues`/`newValues` كاملين — بديل عن soft-delete على `order_team_members` (الجدول فاضل
hard-delete زي ما هو، الاتفاقية الموجودة من `0060`، الـaudit trail كافي لحفظ التاريخ).

**اختبار حي كامل**:
- **jest** (`admin-crew-management.spec.ts`, 14 اختبار، ضد Postgres حقيقي): إضافة ناجحة + 5 حالات
  رفض (مش team mode، فني مش معتمد، الفني هو القائد، عضو مكرر، تجاوز الحد الأقصى)، إزالة ناجحة +
  `crewShortage` صح في الحالتين (كافي/ناقص) + رفض عضو مش موجود، استبدال ناجح (مع/من غير
  `role_label` override) + رفض (نفس الفني، عضو مش موجود)، وتأكيد إطلاق `ORDER_CREW_CHANGED_EVENT`.
- **curl مباشر ضد dev server حقيقي** (نفس تقنية JWT-signing بـ`JWT_ACCESS_SECRET` المستخدمة في
  قسم Call Center فوق): إضافة عضو حقيقية (audit log + DB تحقق)، تعارض عضو مكرر (409)، تحقق
  `class-validator` على `reason` القصير (400) لكل من remove وreplace، استبدال ناجح (DB تحقق
  `technician_id`/`role_label` بعد الاستبدال)، إزالة ناجحة مع `crewShortage=true` صح (required=3،
  بعد الإزالة العدد الكلي 1)، ورفض بدون توكن (401). بيانات الاختبار اتنضّفت بالكامل من الداتابيز
  بعد التحقق (بما فيها `notifications` و`addresses` اللي الحذف الأول اتعثّر عليهم بسبب ترتيب FK).

RBAC (403 لدور من غير `orders.manage_crew`) اتبني على نفس `PermissionsGuard` المستخدم في عشرات
endpoints تانية اتعمل لها اختبار حي قبل كده — مش اتعمل اختبار حي منفصل ليه هنا (وقت الجلسة)، بس
نفس آلية الحارس بالحرف.

**تزامن حقيقي — Script 4 Part Q (2026-08-18)**: مراجعة صريحة لعمليات الأدمن اللي بتلمس نفس الصف
تحت سباق، ملقاش فيها بَقّة إلا واحدة حقيقية:

- **`reassign()`** — كانت آمنة أصلاً: قفل تشاؤمي (`pessimistic_write`) على الفني **أولًا** ثم على
  الطلب (نفس ترتيب `MatchingService.accept()`)، وإعادة تحقق حالة الطلب/الفني تحت القفل. اختبار حي
  جديد (`admin-orders-concurrency.spec.ts`) بيثبت كده فعليًا: أدمنين اتنين بيحاولوا يعيّنوا فنيين
  مختلفين لنفس الطلب بـ`Promise.allSettled` بالتوازي — واحد بس ينجح، التاني يترفض بنظافة `409`،
  ومفيش أي أثر جزئي (الترانزاكشن الخاسر بيترجع بالكامل، صفر سطور `order_status_history` منه).
- **`addCrewMember()`/`replaceCrewMember()`** — **بَقّة حقيقية جديدة اتلقطت**: فحص "الفني مضاف
  بالفعل" في `validateCrewCandidateOrThrow` كان تطبيقي بس (SELECT قبل INSERT)، مش ذرّي — سباق
  حقيقي بين أدمنين بيضيفوا نفس الفني بالتوازي كان ممكن يعدّي الفحص الاتنين قبل ما أي حد يعمل
  INSERT، فيوصل لـ`UNIQUE (order_id, technician_id)` (migration `0060`) كخطأ Postgres خام
  (`QueryFailedError`، بيسرّب كـ500) بدل الرسالة النضيفة `409` المعتادة. الإصلاح: نفس نمط
  `isUniqueViolation(err)` الموجود من زمان في `ratings.service.ts` (فحص `err.code === '23505'`)،
  بيلف `teamMembers.save()` في try/catch ويحوّل الخطأ الخام لنفس رسالة `409` "الفني ده مضاف بالفعل
  لفريق الطلب ده" — الـUNIQUE constraint في الداتابيز فضل خط الدفاع الأخير الفعلي، بس دلوقتي
  بيترجم لرسالة واضحة بدل ما يسرّب.
- **اتعمله اختبار حي**: نفس `admin-orders-concurrency.spec.ts` — أدمنين اتنين بيضيفوا نفس الفني
  لنفس الطلب بالتوازي، واحد بس ينجح والتاني بيرجّع الرسالة النضيفة (مش stack trace خام)، وصف واحد
  بس في `order_team_members` في النهاية. **اتعمله كمان curl مباشر ضد dev server حقيقي** (نفس تقنية
  JWT-signing المستخدمة في باقي القسم ده) — نفس السيناريو بالظبط عبر HTTP فعلي: طلب واحد رجّع
  `200`، التاني `409` بالرسالة النضيفة نفسها — بيانات الاختبار اتنضّفت بالكامل بعدها.

**apps/admin**: كارت "طاقم الطلب" جديد في `/orders/[id]` (بيظهر بس لطلبات `booking_mode='team'`)
— قايمة الأعضاء الحاليين (بعكس كارت "المساعدين" الموجود من قبل اللي بيفلتر `member_type='assistant'`
بس، الكارت الجديد ده لـ`member_type='team_member'` العاديين)، مع 3 إجراءات مقفولة خلف
`hasPermission('orders.manage_crew')`: إضافة عضو (فورم منسدل من نفس قايمة الفنيين المعتمدين
المستخدمة في فورم تعيين المساعد)، إزالة (فورم مضمّن جوّه الصف بسبب إلزامي)، واستبدال (فورم مضمّن
تاني، فني جديد + سبب إلزامي + دور اختياري). تحذير `crewShortage` بيتعرض فورًا فوق القايمة لو
الإزالة الأخيرة سيّبت العدد أقل من `required_technicians`. أنواع `AddCrewMemberBody`/
`RemoveCrewMemberBody`/`RemoveCrewMemberResponseDto`/`ReplaceCrewMemberBody` جديدة في
`packages/shared-types/src/orders.ts` (مطابقة بالحرف لـ`admin-crew-member.dto.ts`). **فجوة موثّقة
صراحة**: مش اتعمل لها اختبار حي بمتصفح فعلي — نفس قيد WebAuthn MFA لتسجيل دخول الأدمن في بيئة
الـsandbox، مذكور في قسم Call Center فوق بالتفصيل. `tsc`/`eslint`/`next build` كلهم نضاف.

## إعادة جدولة عامة من الأدمن (Script 4 Part K §42، 2026-08-18)

كانت فجوة موثّقة صراحة: `OrdersService.reschedule()` (شوف قسم "إعادة الجدولة docs/08 §22 بند
9-12" فوق) مقصور على العميل صاحب الطلب بس (`findOneOwnedOrThrow`) — استخدام تشغيلي حقيقي غير
مغطّى: العميل يتصل بخدمة العملاء يطلب تأجيل الموعد، الموظف بيحتاج ينفذها نيابة عنه بدل الدخول
على الداتابيز يدويًا.

**إعادة استخدام بدل تكرار**: منطق الحجز الذرّي (release القديم + book الجديد جوّه transaction
واحدة، مع القفل التشاؤمي وإعادة التحقق تحت القفل ضد سباق depart()) اتفصل في method خاص
`rescheduleCore()` بيتنادى من الاتنين — `reschedule()` (العميل) و`rescheduleByAdmin()` (الأدمن)
الجديدة. صفر duplicate logic، الفرق بس هوية المنفّذ (`changedByRole`/`changeSource` في
`order_status_history`) + سبب إلزامي (5-500 حرف، `AdminRescheduleOrderDto`) + سطر تدقيق إضافي
(`order.rescheduled_by_admin`) — العميل مش مطلوب منه سبب لما بيعيد جدولة طلبه هو.

**صلاحية مخصصة (`orders.reschedule`, migration `0133`)**: نفس نمط `orders.assign_assistant`/
`orders.manage_crew` — ممنوحة لـ`super_admin` و`ops_manager`، عملية تشغيلية يومية. **مفيش
step-up MFA** (بعكس `orders.adjust_price`/`orders.resolve_failed_visit`) — تغيير موعد مش قرار
مالي، نفس مستوى حساسية `orders.reassign` بالظبط.

**`POST /admin/orders/:id/reschedule`** — `{new_slot_id, reason}`. نفس قيود العميل بالحرف
(الحالة لازم تكون `accepted`/`technician_assigned`، السلوت الجديد لازم يكون لنفس الفني المعيّن).

**requote/scope-change**: تم التأكد إن ده مش فجوة فعلية — الـworkflow الهيكلي موجود بالفعل ومختبر
من سيشنز سابقة (`OrderItemsService.propose()`/`approve()`/`decline()`، حالة `AWAITING_QUOTE_
APPROVAL`، شوف قسم "عرض السعر أثناء التنفيذ" فوق). الأدمن عنده بالفعل رؤية قراءة (`GET
/admin/orders/:id/quote-items`، كارت "بنود العرض" في `apps/admin`) — مفيش حاجة إضافية اتلقطت
تحتاج بناء هنا.

**اختبار حي كامل**:
- **jest** (امتداد لـ`reschedule-and-address-warning.spec.ts`، describe block جديد
  `rescheduleByAdmin()`): إعادة جدولة ناجحة بغض النظر عن هوية العميل + تأكيد `audit_logs`
  (spy حقيقي على `AuditLogService.record`) + `order_status_history` (`changed_by_role='admin'`،
  `change_source='admin'`، السبب متضمّن في النص)، رفض طلب مش موجود، ورفض بعد ما الفني يتحرّك
  فعليًا (`technician_on_way`) — نفس قيد العميل بالحرف، صفر audit log بيتسجّل لما العملية ترفض.
- **curl مباشر ضد dev server حقيقي**: تحقق `class-validator` على `reason` القصير (400)، إعادة
  جدولة ناجحة (DB تحقق `scheduled_at`/سلوت جديد `booked`)، تحقق `audit_logs` و
  `order_status_history` كاملين، ورفض بدون توكن (401). بيانات الاختبار اتنضّفت بالكامل (بما فيها
  `chat_threads` اللي اتعمل تلقائي — الحذف الأول اتعثّر عليه بسبب ترتيب FK، نفس الدرس المتكرر).

**apps/admin**: زرار "إعادة جدولة الموعد" جديد في `/orders/[id]` (بيظهر بس لو `isOrderReschedulable
(order.order_status) && hasPermission('orders.reschedule')` — `isOrderReschedulable` helper جديد
في `order-labels.ts` مطابق حرفيًا لـ`RESCHEDULABLE_STATUSES` في الباك-إند). فورم مستقل عن فورم
"resolve-failed-visit" الموجود من قبل (سياقين مختلفين تمامًا رغم استخدام نفس `GET /technicians/:id/
schedule` لجلب المواعيد المتاحة). **فجوة موثّقة صراحة**: مش اتعمل لها اختبار حي بمتصفح فعلي — نفس
قيد WebAuthn MFA. `tsc`/`eslint`/`next build` كلهم نضاف.

## Timeline موحّد لتفاصيل الطلب (Script 4 Part G §30-32، 2026-08-18)

كانت فجوة موثّقة صراحة: 4 مصادر أحداث منفصلة كل واحدة في كارت لوحدها في `GET /admin/orders/:id`
— `order_status_history` (كارت "تاريخ الحالة")، `technician_order_cancellations` (كارت منفصل)،
`audit_logs` (صفحة `/audit-log` منفصلة تمامًا عن صفحة الطلب)، و`order_assignments` (مفيش عرض
إداري خالص قبل كده). الأدمن مضطر يقفز بين أماكن متفرقة يركّب الصورة الزمنية الكاملة يدويًا.

**`GET /admin/orders/:id/timeline`** — صفر صلاحية إضافية (زي `listTeamMembers`/`listMedia`/
`listQuoteItems` فوق، قراءة بس لأي أدمن). التنفيذ: `AdminOrdersService.getTimeline()` — استعلام
SQL خام واحد (`UNION ALL` عبر الجداول الأربعة + `LEFT JOIN users` لاسم الفاعل) بدل 4 استعلامات +
دمج/ترتيب على مستوى الكود. كل مصدر بيرجّع `{id, ts, source, title, detail, actor_user_id,
actor_full_name, actor_user_type}` موحّد، مرتّب تصاعديًا بـ`ts`. `order_assignments` معندهاش
`actor_user_id` حقيقي (الحدث ده من النظام نفسه، مش فعل بشري)، فبيترجع `null`.

**اختبار حي كامل**:
- **jest** (`admin-order-timeline.spec.ts`, 3 اختبارات، ضد Postgres حقيقي): الحالة الأساسية —
  4 أحداث من 4 مصادر مختلفة، اتأكد إن الترتيب في النتيجة معتمد على `ts` الفعلي (الإدخال في
  الداتابيز كان بترتيب عكسي متعمّد للتأكيد)، واسم الفاعل جاهز صح لكل من `status_history`
  و`audit_log`. مصفوفة فاضية لطلب مفيهوش أحداث. رفض طلب مش موجود.
- **curl مباشر ضد dev server حقيقي**: أحداث من الـ4 مصادر بالفعل في نفس الاستجابة، الترتيب
  الزمني صح (assignment قبل 4 ساعات → status_history قبل 3 ساعات → audit_log قبل ساعة →
  technician_cancellation قبل 30 دقيقة)، أسماء الفاعلين (أدمن/فني) صح، رفض بدون توكن (401)،
  ورفض طلب مش موجود (404). بيانات الاختبار اتنضّفت بالكامل.

**apps/admin**: كارت "Timeline موحّد" جديد في `/orders/[id]` — عرض زمني واحد يجمع الـ4 مصادر مع
`StatusChip` مختلف لكل `source` (تاريخ الحالة/سجل تدقيق/عرض مطابقة/إلغاء فني). **قرار متعمّد**:
اتضاف جنب كارتي "تاريخ الحالة" و"إلغاءات الفني" الموجودين من قبل مش بديل عنهم — إزالتهم كانت
هتوسّع نطاق التغيير لصفحة مختبرة بالفعل من غير داعي حقيقي، والـTimeline الموحّد قيمته المضافة
إنه بيورّي الصورة الكاملة (بما فيها `audit_log`/`assignment` اللي مفيش ليهم كارت خالص) في مكان
واحد، مش إنه لازم يلغي الكروت المتخصصة. **فجوة موثّقة صراحة**: مش اتعمل لها اختبار حي بمتصفح
فعلي — نفس قيد WebAuthn MFA. `tsc`/`eslint`/`next build` كلهم نضاف.

## بَقّة حقيقية اتلقطت واتصلحت — إشعار "الإلغاء التلقائي" كان بيكذب على العميل إنه إلغاء إداري (Script 6 Part 11-14، 2026-08-19)

**الشك الأصلي** (Script 6، اختبار يدوي من المالك): "لما العميل يختار الدفع كاش، الطلب بيتلغي
تلقائيًا من غير سبب واضح." الشك افترض إن السبب متعلق بالدفع الكاش تحديدًا (webhook دفع أونلاين
مش واصل، أو منطق مشابه) — **ده غلط**، والتحقيق أثبت كده حيًا مش نظريًا.

**التتبع الحي الكامل** (طلب كاش حقيقي عبر `POST /orders`، عميل حقيقي، Postgres حقيقي، صفر mocks):
1. `dto.payment_method` غير موجود أصلاً في الـDTO لأي قيمة غير `card`/`instapay` — كاش دايمًا
   `payment_method: undefined`، فالطلب بيتسجّل مباشرة بـ`order_status='searching_technician'`
   (مش `pending_payment` خالص) — **الكاش أصلاً مبيدخلش مسار "فشل دفع أونلاين" من الأساس**، تأكيد
   كود مطابق لما لقاه فحص الكود الساكن في `apps/customer-app` أول ما بدأنا.
2. `MatchingService.dispatchNextRound()` لقى فني واحد بس مؤهل للخدمة/المنطقة، بعت له عرض، وجدول
   `ROUND_EXPIRED_JOB` بعد `matching.response_timeout_seconds` (افتراضي 30 ثانية).
3. الفني ما ردّش (مفيش رفض ولا قبول)، الجولة انتهت، مفيش فني تاني للجولة الجاية → **وقتها**
   `cancelForNoTechnicians()` كانت بتقفل الطلب `CANCELLED_BY_SYSTEM` بسبب `ORDR_002: لا يوجد فنيون
   متاحون حالياً`. **هذا السطر تاريخي** — قرار المالك (2026-08-19) شال السلوك ده بالكامل بعد
   بلاغ لاحق أكّد نفس المشكلة تحديدًا (تفاصيل في `matching/README.md`)؛ نفس السيناريو دلوقتي
   ينتج طلب فاضل `SEARCHING_TECHNICIAN` + إشعار أدمن، مش إلغاء.

**الاستنتاج (وقت الاختبار الأصلي، لسه صحيح جزئيًا)**: الإلغاء (وقتها) كان حقيقي 100%، بس **مالوش
أي علاقة بطريقة الدفع** — أي طلب (كاش أو كارت) كان هيتلغي بنفس الطريقة بالظبط لو مفيش فني رد خلال
30 ثانية. العميل اللي بلّغ عن المشكلة على الأغلب كان بيختبر في بيئة فيها فنيين قليلين/بعيدين، وحصل
بالصدفة وهو مجرّب كاش. **دلوقتي مفيش إلغاء خالص في السيناريو ده — الاستنتاج الأهم (مالوش علاقة
بطريقة الدفع) لسه صحيح، بس النتيجة النهائية اتغيّرت من "يتلغي" لـ"يفضل يدوّر".**

**البَقّة الحقيقية الفعلية اللي اتلقطت** (مش الشك الأصلي، لكن أخطر منه فعليًا — Part 12/14):
`OrderStatusNotificationListener.handleOrderStatusChanged()` كان بيفترض إن `CANCELLED_BY_SYSTEM`
= "إلغاء إداري من لوحة الأدمن" **دايمًا** (تعليق قديم صريح بالنص ده)، رغم إن `MatchingService`/
`OrderAutoCancelService` بيستخدموا **نفس الحالة بالظبط** للإلغاء التلقائي البحت (صفر تدخل بشري).
النتيجة الفعلية اللي اتأكدت حيًا: عميل طلبه اتلغى تلقائيًا لأن محدش رد، استلم إشعار push/in-app
بعنوان **"طلبك اتلغى من الإدارة"** ونص **"السبب: ORDR_002: لا يوجد فنيون متاحون حالياً"** —
كذب صريح على مصدر الإلغاء (مفيش أدمن لمس الطلب خالص) + تسريب كود داخلي خام في نص العميل
(بالظبط الممنوع في Part 14: "Do not expose SQL/internal technical errors").

**الإصلاح**: `OrderStatusChangedEvent` اتضافله حقل جديد `cancelledByUserId: string | null` —
المُميّز الحقيقي (مش افتراض) بين الحالتين: `admin-orders.service.ts.cancel()` بيبعت
`adminUserId` الفعلي، `matching.service.ts`/`order-auto-cancel.service.ts` بيسيبوه `null`
(الافتراضي). الـlistener بقى بيفرّع فعليًا: `cancelledByUserId !== null` → نفس رسالة "من
الإدارة" القديمة زي ما هي، غير كده → `order_cancelled_automatically` جديد بعنوان "اتلغى طلبك
تلقائيًا" ونص السبب **بعد** إزالة أي كود داخلي (`stripInternalErrorCodePrefix()` — regex بسيطة
`/^[A-Z]+_\d+:\s*/` بتشيل بادئة زي `ORDR_002:` وتسيب النص العربي المفهوم اللي بعدها زي ما هو).

**اتأكد الإصلاح حيًا مرتين** (قبل/بعد، نفس السيناريو بالظبط — طلب كاش حقيقي، انتظار 30 ثانية
حقيقي لحد ما الجولة تنتهي، فحص صف `notifications` الفعلي في القاعدة):
- قبل: `notification_type='order_cancelled_by_admin'`, `title_ar='طلبك اتلغى من الإدارة'`,
  `body_ar='السبب: ORDR_002: لا يوجد فنيون متاحون حالياً'`.
- بعد: `notification_type='order_cancelled_automatically'`, `title_ar='اتلغى طلبك تلقائيًا'`,
  `body_ar='لا يوجد فنيون متاحون حالياً'` (صفر كود داخلي).

**Timeline الموحّد للأدمن (Script 4) كان سليم من الأساس** — `getTimeline()` بيقرا
`order_status_history.reason` مباشرة، فـ`ORDR_002: لا يوجد فنيون متاحون حالياً` كان ظاهر
للأدمن بالفعل بالتوقيت والمصدر (`change_source='system'`) الصح حتى قبل الإصلاح ده. البَقّة كانت
مقصورة على الإشعار اللي بيوصل للعميل بس.

**فجوة موثّقة صراحة متبقية**: أكواد الخطأ الحالية لعدم توفّر عنوان/منطقة (`ORDR_001`) لسه بس
رسالتين عامتين ("العنوان مش مربوط بمدينة" / "الخدمة غير متاحة في منطقتك لسه") بدل الأكواد
التسعة الأدق اللي طلبها Script 6 (`NO_COORDINATES`, `OUTSIDE_SERVICE_AREA`, `CITY_NOT_LINKED`,
...) — قرار مؤجل عمدًا لأن الرسالتين الحاليتين فعلاً واضحتين وصحيحتين للعميل (Part 14 راضي)،
والتفريق الأدق قيمته الحقيقية للتشخيص الداخلي بس (مش تجربة العميل)، وده نطاق أكبر من "بَقّة
حقيقية" — قرار تصميم يحتاج وقت مخصص، مش جزء من الالتزام "أصلح الحقيقة في الباك-إند" هنا.

## Idempotency-Key لإنشاء الطلب — كانت فجوة حقيقية، اتقفلت (Script 7 Phase 9، 2026-08-19)

`POST /orders` — أهم endpoint في المنصة كلها (بيوزّع فني حقيقي، وممكن يخصم محفظة لو دفع
prepaid) — كان بلا أي حماية Idempotency-Key خالص، بعكس كل عمليات الدفع (`payments.controller.ts`)
اللي بتفرضه صراحة (docs/01 §1.4). عميل بيدوس زرار "أكّد الحجز" مرتين (شبكة بطيئة، double-tap)
كان يقدر ينشئ طلبين حقيقيين لنفس النية.

**الحل**: نفس نمط `PaymentsService.payWithWallet()` بالحرف — عمود `idempotency_key` (migration
0139) بفهرس فريد جزئي على `(customer_id, idempotency_key)`. `OrdersService.create()` بياخد
`idempotencyKey?` اختياري كخامس parameter: فحص مبكر رخيص قبل أي عمل (تحسين أداء)، والفهرس
الفريد نفسه هو الحماية الحقيقية ضد سباق متزامن حقيقي — `try/catch` حوالين الـtransaction بيمسك
`23505` على الفهرس ده تحديدًا ويرجّع الطلب الأصلي بدل ما يسرّب خطأ DB خام للعميل.

الهيدر اختياري في الكونترولرات (`orders.controller.ts`، `admin-orders.controller.ts`) — مش زي
الدفع اللي بيفرضه إجباري — عشان مانكسرش أي كلاينت قديم ما حدّثش لسه. لكن الكلاينتات التلاتة
(customer-app، customer-web، call-center admin) اتحدّثوا كلهم يبعتوه فعليًا، بنفس درس
`generateIdempotencyKey()` الموثّق في `payments_repository.dart`: **المفتاح لازم يتولّد مرة
واحدة بس** (state field في Dart، `useState(() => crypto.randomUUID())` lazy initializer في
React) ويتبعت تاني لأي retry — توليد مفتاح جديد جوّه دالة الإرسال نفسها كان هيلغي الحماية
تمامًا لأي retry حقيقي.

`recurring-orders.service.ts` **متأثرش عمداً** — عنده حماية idempotency خاصة بيه أصلاً
(`(recurring_template_id, recurring_occurrence_at)`, `findGeneratedOrder()`) أقوى وأدق من مفهوم
مفتاح واحد لكل نداء، فمش بيبعت `idempotencyKey` خالص للـ`create()` (عمود `NULL` للطلبات دي).

**اختبار حي**: `order-creation-idempotency.spec.ts` (4 اختبارات) — بما فيها اختبار سباق متزامن
حقيقي (`Promise.all` بنفس المفتاح، بيثبت الفهرس الفريد + منطق `catch` شغالين صح مش بس الفحص
المبكر).

## إعادة الزيارة تحت الضمان — سلسلة مجانية بلا نهاية، كانت بَقّة حقيقية (Script 7 Phase 23، 2026-08-19)

`settleAndComplete()` بتحسب `warranty_expires_at` لأي طلب مكتمل بلا استثناء لـ`order_type=revisit`
— يعني إعادة زيارة مجانية، لما تكتمل هي كمان، بتاخد ضمان **جديد بالكامل** بنفس مدة `service.warranty_days`.
الفحص القديم عند إنشاء إعادة زيارة كان بيتحقق بس من: نفس الخدمة/العنوان، `orderStatus=COMPLETED`،
و`warranty_expires_at` لسه سارٍ — من غير أي فحص على `order_type` بتاع الطلب الأصلي نفسه. النتيجة:
إعادة زيارة كانت تقدر تبقى `original_order_id` لإعادة زيارة تانية، وهكذا للأبد طالما العميل بيطلب
واحدة جديدة قبل ما ضمان آخر واحدة يخلص — خدمة مجانية متكررة بلا أي حد، والفني ملوش أي تعويض بعد
أول إعادة زيارة.

**الحل**: فحص صريح جديد في `OrdersService.create()` — لو `originalOrder.orderType === OrderType.REVISIT`،
الطلب بيترفض بوضوح (`VAL_001`, "إعادة الزيارة تحت الضمان مسموحة مرة واحدة بس لكل طلب أصلي"). إعادة
الزيارة تفضل مسموحة مرة واحدة بس لكل طلب أصلي مدفوع حقيقي — تعديل `warranty_expires_at` وقت
اكتمال إعادة الزيارة نفسها اتسيب زي ما هو عمدًا (بيفضل معلومة تاريخية على الطلب، بس مش قابل
للاستخدام كأصل لإعادة زيارة تانية بعد الفحص الجديد).

**اختبار حي**: `order-revisit-chain.spec.ts` (اختباران) — إعادة زيارة لطلب أصلي عادي بتنجح (تأكيد
المسار السليم)، وإعادة زيارة لإعادة زيارة تانية بترفض بوضوح.

## Golden Path — رحلة حجز كاش كاملة (Script 7 Phase 34، 2026-08-19)

`golden-path-cash-booking.e2e.spec.ts` — أول اختبار regression دائم لرحلة العميل الكاملة (كانت
دايمًا اختبار حي يدوي متكرر في كل سيشن بلا أثر باقٍ). بيغطي: `OrdersService.create()` (كاش) →
محاكاة توزيع/قبول (matching.service.ts نفسها مختبرة بعمق منفصل) → `depart()`/`arrive()`/`start()`
→ فحص صورة "بعد الشغل" الإجباري (رفض `ORDR_005` حقيقي قبل ما الصورة تتضاف) → `complete()` →
`PaymentsService.collectCash()` → `settleAndComplete()` (عمولة/أرباح/ضمان بالأرقام بالظبط) → قيد
محفظة مزدوج حقيقي (`COMMISSION_DEDUCTION`، delta محفظة المنصة مش قيمتها المطلقة — المحفظة مشتركة
بين كل اختبارات jest) → `RatingsService.rateAsCustomer()` (+ رفض تقييم تاني لنفس الطلب) → فحص
`order_status_history` الكامل بالترتيب الصح. كل خطوة بتنادي نفس دالة الخدمة الحقيقية اللي الـ
controller بينادّيها، مش محاكاة منفصلة — الوحيد اللي اتحاكى هو نتيجة `matching.service.ts` (تعيين
فني)، لأن الموديول ده نفسه له تغطية اختبار منفصلة عميقة.

## بَقّة حقيقية اتلقطت في CI (مش على الجهاز المحلي) — `SELECT ... LIMIT 1` بلا `ORDER BY` لاستعارة نطاق خدمة (2026-08-19)

`admin-crew-management.spec.ts`, `admin-order-timeline.spec.ts`, `admin-orders-concurrency.spec.ts`
كانوا بيستعيروا نطاق خدمة موجود بـ`SELECT id FROM service_zones LIMIT 1` بدل ما ينشئوا نطاقهم
الخاص (زي كل ملف اختبار حي تاني في المشروع). محليًا (قاعدة تطوير مشتركة فيها نطاقات دائمة مزروعة
من migrations قديمة) كان ده دايمًا بيرجّع نفس الصف الثابت القديم فمفيش مشكلة ظهرت. على CI (قاعدة
بيانات فاضية تمامًا لكل تشغيلة، وملفات jest كتير بتتشغّل بالتوازي في workers مختلفة) أول نطاق
موجود ممكن يكون نطاق أنشأه ملف اختبار **تاني** (مثلاً `refund-transaction-safety.spec.ts`) بيقصد
يحذفه في `afterAll` بتاعه — فلو ملف من التلاتة دول استعاره وعمل عليه `orders` قبل ما يتحذف، محاولة
`DELETE FROM service_zones WHERE id=$1` بتاعة الملف الأصلي بترفض بـ`orders_service_zone_id_fkey`،
والسويت كله يترمز "Test suite failed to run" حتى لو كل الاختبارات جوّاه فعليًا نجحت (لقطة فعلية:
CI رجّع `Test Suites: 1 failed, 101 passed` مع `Tests: 557 passed, 557 total` — كل اختبار نجح،
بس الـ`afterAll` نفسه رمى استثناء). نفس فئة BUG-002 الموثّقة قبل كده بالحرف (تنظيف ناقص/غير معزول
بيكسر السويت كله)، بس هنا السبب استعارة صف بدل إنشاء صف خاص، مش ترتيب DELETE ناقص.

**الإصلاح**: التلات ملفات بقى كل واحد فيهم بينشئ `country`→`city`→`service_zone` خاصة بيه في
`beforeAll` (بنفس الاتفاقية المستخدمة في كل ملف اختبار حي تاني بالمشروع) ويمسحهم في `afterAll`
بعد كل حاجة بتشير ليهم. صفر اعتماد على أي صف مشترك مع ملف تاني بعد كده.

## ADR-0017 — إلغاء الفني لطلب "بعيد" اتأكد تلقائيًا ممنوع تمامًا (2026-08-19)

راجع `../matching/README.md`'s قسم ADR-0017 و`docs/adr/0017-booking-availability-opt-out-model.md`
للسياق الكامل. المالك طلب صراحة: طلب اتأكّد تلقائيًا لفني (`MatchingService.autoConfirmFutureOrder()`
— بلا قبول فعلي من الفني) ميقدرش يتلغى ذاتيًا زي طلب عادي، لازم يعدّي عبر الدعم/الأدمن. `OrdersService
.technicianCancel()` و`getTechnicianCancellationPolicy()` (المستشاري، بيستخدمه `apps/technician-app`
قبل ما يعرض زرار الإلغاء) الاتنين بيستدعوا `wasAutoConfirmedBySystem(orderId)` (استعلام مباشر على
`order_status_history` — `change_source='system' AND new_status='accepted'`، بلا عمود جديد، نفس
فلسفة استنتاج ADR-0006 §3 بالحرف) ويرفضوا الإلغاء الذاتي برسالة `ORDR_004` واضحة لو `true`. **فجوة
موثّقة**: مفيش اختبار حي مخصص لـ`technicianCancel()` نفسها لحد كتابة السطر ده — `OrdersService`
عندها تبعيات كبيرة (تسعير/دفع/محافظ) بتخلّي بناء fixture معزول مكلّف، مؤجَّل لمرحلة التحقق الحي
الشاملة (E2E) بدل اختبار وحدة منفصل.

## بَقّة حقيقية اتلقطت — استرجاع الطلب النشط للفني كان ممكن يرجّع الطلب الغلط (docs/08 §165)

نتيجة مباشرة لميزة "ASAP واحد + N طلبات مجدولة" (migration 0144، ADR-0017): `ACTIVE_TECHNICIAN
_ORDER_STATUSES` (`order-state-machine.ts`) بتفترض ضمنياً صف واحد بس بيطابق فني بعينه في أي لحظة —
افتراض كان صحيح قبل الميزة دي (فني واحد بياخد طلب `accepted` واحد بس)، بقى غير صحيح دلوقتي (طلب
ASAP شغال فعليًا + طلب مجدول مستقبلي `accepted` مؤكّد تلقائيًا في نفس الوقت). `findActiveForTechnician()`
(هنا) و`order-tracking.gateway.ts`'s استعلام بث الموقع اللحظي الاتنين كانوا `findOne()` بلا فلترة
على `scheduled_at` — يعني ممكن يرجّعوا الطلب المجدول (لسه معاداش موعده) بدل الطلب الشغال فعليًا لو
كان الأحدث تحديثًا. الإصلاح: الاتنين بقيا بيستبعدوا أي طلب `scheduled_at` في المستقبل (`IS NULL
OR <= now()`). `findUpcomingConfirmedForTechnician()` (جديدة، عكس الفلتر ده تمامًا) بتغذّي
`GET /technician/orders/upcoming-confirmed` — كانت فجوة حقيقية تانية: الطلبات المجدولة المؤكّدة
دي مفيش أي شاشة في `apps/technician-app` كانت بتعرضها للفني قبل يوم تنفيذها (`UpcomingConfirmedJobsScreen`
الجديدة، تفاصيل كاملة في `../../../technician-app/README.md`). اختبار حي كامل في
`technician-active-order-recovery.spec.ts` بيثبت الفصل الصح، بما فيه لحظة وصول موعد الطلب المجدول.

## بَقّة ASAP الحقيقية + إلغاؤها من الواجهة + "مرن — اختار نطاق أيام" (docs/08 §32، طلب مالك صريح 2026-08-20)

بلاغ مالك حقيقي: `apps/customer-app`'s "في أقرب وقت ممكن" كانت بترفض فنيين متاحين فعلاً (تفاصيل
السبب الجذري الكامل في `../technicians/README.md` و`../matching/README.md`، الإصلاح في
`technician-eligibility.sql.ts`). المالك طلب كمان إلغاء الخيار ده من الواجهة نهائيًا (بيوحي بطوارئ
مش موجودة فعليًا) وإضافة "مرن — اختار نطاق أيام" بدله.

**`CreateOrderDto.scheduled_at_range_end`** (جديد، اختياري) — لو اتبعت مع `scheduled_at`،
`OrdersService.create()` بيدوّر يوم بيوم داخل `[scheduled_at, scheduled_at_range_end]` (الاتنين
شاملين، أقصى 14 يوم — `ApiException` واضح لو النطاق أكبر أو `scheduled_at` مفقود) عبر
`TechniciansService.hasEligibleTechnicianForDate()` (استعلام `EXISTS` خفيف، تفاصيل في
`../technicians/README.md`) لحد ما يلاقي أول يوم فيه فني مؤهّل واحد على الأقل، ويثبّت `scheduledAt`
النهائي على اليوم ده. لو محدش متاح في كل النطاق، بيرجع لبداية النطاق كما هو — نفس فلسفة "مفيش
إلغاء تلقائي لمجرد مفيش فني دلوقتي" الموجودة أصلاً (`MatchingRecoveryService.sweep()` هتعيد
المحاولة تلقائيًا). مينفعش يتبعت مع `schedule_slot_id` (سلوت محدد أصلاً موعد صريح، مفيش داعي نطاق).

**`apps/customer-app`**: `ScheduleSelectionScreen` بقت تاريخ إجباري دايمًا (اتشال خيار "في أقرب
وقت ممكن" نهائيًا) + خيار "مرن" (`showDateRangePicker`). وصف "شغلانة سريعة — حد يخلّصها بسرعة"
لوضع الحجز الفردي اتشال كمان (بيوحي باستعجال يتلخبط مع "طوارئ" الفعلي) — بقى "فردي" بس. تفاصيل
كاملة (السبب الجذري بكامله، القرار، وتأكيد إن طلبات الطوارئ أصلاً بتفضل ظاهرة لحد القبول —
ADR-0018 §5 منفّذ بالفعل مش مطلوب جديد) في `docs/08-pricing-engine-and-platform-vision.md` §32.

## تصعيد نقص طاقم قبل الموعد (docs/08 §35.5، ADR-0021)

`CrewShortageEscalationService` (فحص دوري كل دقيقة، نفس نمط `OrderAutoCancelService` بالحرف —
إعادة تقييم من Postgres مباشرة كل مرة، مفيش حالة متخزّنة في Redis ممكن "تعلق") بيدوّر على طلبات
فريق قبل ما تبدأ التنفيذ فعليًا (`technician_assigned`/`accepted`/`technician_on_way`/
`technician_arrived`)، موعدها هيوصل خلال `orders.crew_shortage_escalation_hours_before` ساعة
(افتراضي 24، `/settings`)، ولسه ناقصة طاقم فعليًا عبر `OrderTeamService.getCrewComposition()`
الحقيقية (صفر خوارزمية موازية). تصعيد **لمرة واحدة بس لكل طلب** — عمود
`orders.crew_shortage_escalated_at` (migration `0156`) بيمنع التكرار كل دقيقة؛ ده "تنبيه قوي" عند
عبور العتبة زي ما المالك طلب، مش نظام تذكيرات متكرر كامل. الحدث `order.crew_shortage_escalated`
بيتوجّه لـ`ops_manager` عبر `NotificationRoutingService.routeToRole()` الموجود (نفس نمط
`OrderNoTechnicianFoundRoutingListener` بالحرف).

**"الطلب مميّز بصريًا"** محسوب وقت القراءة في `AdminOrdersService.getDetail()`
(`crew_shortage_urgent` في استجابة `GET /admin/orders/:id`) — مش state مخزّن إضافي، نفس عتبة
`CrewShortageEscalationService` بالظبط عشان الإشعار والتمييز البصري يفضلوا متسقين مع بعض دايمًا.

## كارت رؤية طاقم الطلب للأدمن — "مين ضاف مين وإمتى" (docs/08 §35.16)

الكارت نفسه كان موجود فعليًا من قبل §35.16 (تركيبة `GET /admin/orders/:id`'s `crew_status`/
`technician_contact` + `GET /admin/orders/:id/team-members`) — الفجوة الحقيقية الوحيدة كانت "مين
ضاف": عمودين `added_by_technician_id`/`added_by_admin_user_id` موجودين في `order_team_members` من
§35.1-3/§35.6 بس مالهمش استهلاك فعلي. `OrderTeamService.listForOrder()` بقى بيحل الاسم الحقيقي
(`added_by: {type: 'leader'|'admin', name}`) عبر `LEFT JOIN` بسيط — صفر migration جديدة، صفر جدول/
نظام تسجيل جديد.

## تايم لاين مطابقة الطلب (docs/08 §35.14)

`AdminOrdersService.getTimeline()` الموحّد (Script 4 Part G §30-32) كان أصلاً الحل الصحيح لطلب
المالك ("event-sourced، إعادة استخدام بنية الحدث/audit الموجودة") — اتوسّع بمصدرين جداد بس، صفر
جدول جديد: `technician_work_opportunities` (فرص اختيارية §34.1 + تجنيد فريق §35.1-3، فرع `UNION`
عادي) و`crew_shortage_escalation` (صف تركيبي من `orders.crew_shortage_escalated_at` نفسه، §35.5).

## فجوة إشعار تجنيد الفريق — ✅ اتصلحت (docs/08 §36.1)

`OrderTeamService.recruitMember()` كان بيعمل INSERT فعلي في `technician_work_opportunities`
(context=`crew_recruit`) لما الفني المرشّح يبقى MEANINGFUL/HEAVY — بس صفر حدث كان بيتصدّر لحظتها،
يعني الفني مكانش عنده أي إشارة real-time إن قائد فريق دعاه. بعد `offerIfNotExists()`، لو
`opportunity.created===true` بس، `recruitMember()` بيطلق `WORK_OPPORTUNITY_OFFERED_EVENT`
(`../../common/events/work-opportunity-offered.event.ts`) المستهلَك في `../notifications/listeners
/work-opportunity-offered-notification.listener.ts`. اختبار حي في `order-team-recruiting.spec.ts`
(داخل اختبار `recruitMember — فني MEANINGFUL/HEAVY` الموجود) بيتأكد الحدث بيتصدّر مرة واحدة بس حتى
لو نفس الفني اتنادى عليه تاني (idempotent). تفاصيل السبب الجذري الكامل والتحقيق في
`docs/08-pricing-engine-and-platform-vision.md` §36.1.

## مفتّش المطابقة في صفحة تفاصيل الطلب (docs/08 §36.5)

**صفر endpoint جديد**: قسم `apps/admin/src/app/orders/[id]/page.tsx` (كارت "مفتّش المطابقة")
بيستهلك endpoint-ين موجودين بالفعل في `admin-orders.controller.ts` من §35.7/§35.8
(`GET :id/matching-funnel`، `GET :id/technicians/:technicianId/explain`) — مكانوش مستخدَمين في أي
واجهة أدمن خالص قبل كده رغم وجودهم في الباك-إند من قبل. `matchingFunnel` بيتحمّل تلقائيًا مع باقي
مصادر الصفحة (مسار منفصل، فشل هادئ متوقّع 400 لطلبات بلا `service_zone_id`). فورم "ليه/ليه لأ؟"
بيستخدم `eligibleReassignTechnicians` الموجود بالفعل (مصدر فنيين نفس نطاق/فئة الطلب، §ADR-0017
بند 4) بدل تكرار قايمة فنيين جديدة.

**ملحوظة تسمية حقيقية اتوثّقت في `packages/shared-types/src/matching-explainability.ts`**:
`crew_status` (من كل الـendpoint-ين) بيرجّع كائن `CrewComposition` من `order-team.service.ts`
مباشرة من غير أي تحويل تسمية — يعني حقوله الداخلية **camelCase** (`requiredTechnicians`...)، عكس
باقي الحقول في الاستجابة اللي `snake_case`. سلوك حقيقي موجود بالفعل في الكود (مش اختراع)، موثّق
صراحة عشان أي استهلاك جديد للـendpoint ده يعرف الفرق.

**تحقق حي (curl + JWT حقيقي بنفس سر `.env`، ضد Postgres/طلب حقيقيين)**: الاتنين رجّعوا شكل مطابق
تمامًا لـDTOs الجديدة — `matching-funnel` رجّع `pool`/`dispatch_assignments` صح لطلب حقيقي مُلغى،
`explain` رجّع 8 checks + `capacity_tier`/`distance_km` صح لفني حقيقي. `apps/admin`: `next build`
كامل نضاف صفر أخطاء.

## بَقّتين تزامن حقيقيتين اتلقطوا واتصلحوا في `acceptCrewOpportunity()` (docs/08 §35.19)

الآلية الأساسية (قفل `pessimistic_write` على الطلب + إعادة فحص `composition`/الأهلية تحت القفل)
كانت موجودة من §35.1 نفسها، بس مفيش أي اختبار حي كان بيثبتها — أول اختبار حي كُتب لها
(`order-team-accept-crew-opportunity.spec.ts`) كشف بَقّتين حقيقيتين:

1. **قايمة الرد بعد القبول ناقصة العضو اللي اتضاف لسه**: `this.listForOrder(order.id)` كان
   بيتنادى *جوّه* المعاملة نفسها، بس `listForOrder()` بيستخدم `this.teamMembers.manager` (اتصال
   منفصل) — تحت Read Committed، ده مايشوفش كتابة معلّقة لسه من معاملة تانية. الإصلاح: المعاملة
   بترجّع `orderId` بس، و`listForOrder()` بتتنادى بعد الـcommit فعليًا.
2. **تعليم فرصة خاسرة `declined` كان بيتلغي بصمت مع الـrollback**: `markDecided(..., 'declined')`
   كان بيتعمل **قبل** الاستثناء اللي بيخلي المعاملة كلها ترتد — يعني التعليم نفسه كان بيتلغى مع
   باقي المعاملة، والفرصة كانت تفضل `offered` للأبد شكليًا رغم إنها فعليًا راحت لحد تاني. الإصلاح:
   `CrewOpportunityDeclinedError` (علامة داخلية) بتتمسك بره المعاملة بعد الـrollback، و`markDecided`
   بيتعمل بكتابة منفصلة قبل رمي الخطأ الحقيقي.

اختبار حي (4/4): قبول صحيح، فرصتين بالتوازي على مكان واحد بس (واحد يفوز، التاني `declined`
فعليًا)، إعادة فحص القدرة وقت القبول (الفني حظر اليوم بعد العرض)، والعدد مكتمل بالفعل (بلا سباق).

## حجز فني (شغالة) مباشر — هجرة الشغالة للمحرك الموحّد (docs/08 §42 Phase A.4 Slice 2a، ADR-0029)

`create()` بقت بتاخد `dto.domestic_worker_profile_id`/`dto.duration_hours` — العميل اختار فني
(شغالة) بعينه من التصفح المباشر (زيرو مطابقة تلقائية، ADR-0004)، مش سايب المطابقة تختار. القرار
الكامل (ليه مش نفس مسار `matching.service.ts accept()`، تفاصيل البحث اللي سبق الكود) في
`docs/adr/0029-domestic-worker-unified-booking-migration.md`.

- **فحوصات جديدة** (جوّه `create()`، بعد تحميل الخدمة والمنطقة): خدمة `pricingModel=worker_rate`
  لازم `domestic_worker_profile_id` (والعكس)، ممنوعة مع `schedule_slot_id`/`requested_technician_id`
  (الفني معروف بالفعل)، ممنوعة مع `payment_method` (دفع مقدّم مش مدعوم لسه — مؤجّل عمدًا)، الفني
  لازم `verification_status=approved` وعنده `hourly_rate_cents` (نموذج بالساعة بس، الشهري مؤجّل
  لـSlice 4).
- **الطلب يتسجّل `ACCEPTED` مباشرة، مش `SEARCHING_TECHNICIAN`** — `assignedAt`/`acceptedAt` بيتسجّلوا
  وقت الإنشاء، `technicianId` يفضل `null`، `domesticWorkerProfileId` مسجّل. السعر =
  `hourlyRateCents × duration_hours` (بيتحسب هنا، بيتمرّر لـ`CatalogService.estimate()` كـ
  `precomputedWorkerRateCents`، Phase A.4 Slice 1).
- **صفر حدث جديد** — `ORDER_CREATED_EVENT` الموجود بيتصدّر عادي في نهاية `create()` زي أي طلب
  (الطلب مش `PENDING_PAYMENT` أبدًا في المسار ده، فمفيش تأجيل). كل الـlisteners الموجودة اتأكد
  إنها آمنة بلا تعديل — `OrderDispatchListener`/`CustomerStatsRecalculationListener`/
  `EmergencyOrderRoutingListener` كلهم بيتفحصوا على `orderStatus`/`bookingMode` أصلاً، عدا
  `OrderCreatedNotificationListener` اللي احتاج فرع رسالة صح (راجع `notifications/README.md`).
- **اختبار حي جديد**: `domestic-worker-direct-booking.e2e.spec.ts` (5/5).
- **خارج نطاق الشريحة دي عمدًا**: دفع مقدّم، تأكيد فني صريح (auto-confirm مؤقت دلوقتي)، شات، أي
  واجهة Flutter/أدمن — التفاصيل الكاملة والشرايح الجاية في ADR-0029.
- **تحديث (ADR-0030)**: الفرع ده بقى بيفحص تعارض جدولي حقيقي قبل الإنشاء
  (`DomesticWorkersService.assertNoSchedulingConflict()`) + بيسجّل `domesticWorkerDurationHours`
  على الطلب (كان ناقص). تفاصيل كاملة في `../domestic-workers/README.md`.
