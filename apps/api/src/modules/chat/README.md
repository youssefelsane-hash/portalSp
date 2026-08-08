# modules/chat

محادثات الطلب بين العميل والفني. جداول: chat_threads, chat_messages (قاموس §9.1-9.2). is_flagged لازم يكشف محاولات تبادل أرقام.

**الحالة: شغال (S6).**

- الخيط (`chat_thread`) بيتعمل تلقائياً لما الفني يقبل الطلب — مستمع لحدث `order.accepted` من `matching` (بره الـ transaction، زي كل الأحداث التانية في المشروع)، مش استدعاء مباشر.
- `ChatGateway` (WebSocket, namespace `/chat`): الاتصال لازم يحمل نفس JWT access token المستخدم في REST (`handshake.auth.token`). `chat:join` بيتحقق إن المستخدم فعلاً طرف في الخيط (عميل أو فني) قبل ما يخليه يدخل الـ room، و`chat:send` بيبعت `chat:message_received` لكل الأطراف فوراً.
- `contact-info-detector.ts`: كشف عملي (regex) لمحاولات تبادل أرقام موبايل — بيعلّم الرسالة (`is_flagged`) بدل ما يرفضها، عشان رسائل شرعية فيها أرقام (عناوين، مواعيد) متتحظرش.
- `GET/POST /chat/threads/:id/messages`: نفس الوظيفة عبر REST لو الكلاينت مش عايز WebSocket.
- **`GET /chat/orders/:orderId/thread` — endpoint جديد، كانت فجوة موثّقة صراحة اتقفلت**: مفيش كان طريقة للكلاينت (`customer-app`/`technician-app`) يكتشف الـ `thread_id` بتاع طلب معيّن — `createThreadForOrder` بيتنادى تلقائياً بس النتيجة (الـ `thread_id`) ماكانتش بترجع لحد. الـ endpoint الجديد ده بيرجّع `404` صريح ("مفيش محادثة للطلب ده لسه") لو الفني لسه ما قبلش، و`403` لو المستخدم مش طرف في الطلب. اتضاف `ThreadResponseDto` مقابل، وGET الأصلي اتنقل من `chat/threads/:id/messages` لتحت `@Controller('chat')` موحّد (بدل `chat/threads`) عشان يستوعب المسار الجديد `chat/orders/:orderId/thread` بجانب `chat/threads/:id/messages` القديم بنفس الشكل بالظبط.
- اتعمله اختبار end-to-end فعلي بعميلين WebSocket حقيقيين (مش mock): رسالة عادية وصلت للطرفين فوراً وهي `is_flagged:false`، ورسالة فيها رقم موبايل مصري وصلت وهي `is_flagged:true`، وطرف تالت مش صاحب الخيط اترفض بـ 403 لما حاول يوصله عبر REST. اتعمله كمان اختبار حي تاني من جوّه `customer-app` (`test_live/chat_live_test.dart`): طلب حقيقي قبل القبول رجّع `404` صريح على `GET /chat/orders/:id/thread`، بعد القبول رجّع الـ thread الصح، عميل وفني حقيقيين اتصلوا بـ WebSocket وتبادلوا رسالتين حقيقيتين لحظياً، وتاريخ الرسائل عبر REST طابق بالظبط.
- لسه من غير: `support_chat` (شات الدعم، منفصل عن شات الطلب)، صور/مرفقات في الرسائل.

## قفل الخيط تلقائياً 24 ساعة بعد اكتمال الطلب (`closes_at`) — كانت فجوة موثّقة، اتقفلت

**اكتشاف مهم وقت الإصلاح**: فحص `closes_at` كان **موجود بالفعل** في `sendMessage()` (`if (!thread.isActive || (thread.closesAt && thread.closesAt.getTime() < Date.now())) throw ...`) — بس مفيش حاجة في الكود كله كانت بتحطّ قيمة لـ`closes_at` أصلاً، فالفحص ده كان ميت (dead code) من الناحية العملية. مكانش محتاج منطق قفل جديد، بس اللي كان ناقص فعلياً هو نقطة الدخول.

- **السبب الجذري الحقيقي**: انتقال حالة `completed` بيحصل في `payments.service.ts` (`settleAndComplete()`, بتتنادى من `collectCash()` و`payWithWallet()`) — مش في `orders.service.ts` زي كل انتقالات الفني التانية. `payments` مكانش بيصدّر `order.status_changed` خالص لحالة `completed` (فجوة موثّقة كمان في `notifications/README.md`)، فمفيش أي listener كان يعرف إن الطلب خلص.
- **الإصلاح**: `collectCash()` و`payWithWallet()` الاتنين دلوقتي بيصدّروا `order.status_changed` (بره الـ transaction، بعد ما التسوية تتقفل فعلاً) بعد التسوية — نفس النمط بالظبط المُستخدم لباقي انتقالات الفني في `orders.service.ts`. `OrderCompletedChatCloseListener` (موديول `chat`) بيسمعها، ولو `newStatus=completed` بيحط `closes_at = now() + 24h` على خيط الطلب (idempotent — استدعاء تاني بيمدّد المهلة بدل ما يكسر حاجة).
- اتعمله اختبار حي كامل على 3 طلبات حقيقية: طلب اكتمل بدفع كاش (`collectCash`) → `closes_at` اتسجّل فوراً بالظبط `+24h` من وقت الدفع (اتأكد بمقارنة الطابع الزمني مباشرة). رسالة اتبعتت فوراً بعد الاكتمال (لسه جوّه الـ24 ساعة) نجحت عادي. محاكاة انقضاء المهلة (`UPDATE closes_at = now() - 1 minute` مباشر على القاعدة) خلّت أي محاولة إرسال بعد كده ترفض `409` "المحادثة دي مقفولة" — الفحص القديم اشتغل فعلياً لأول مرة. طلب تاني اكتمل بدفع من المحفظة (`payWithWallet`) → نفس الشيء بالظبط، يثبت إن الإصلاح شغال على مسارين الدفع الاتنين مش واحد بس.

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
