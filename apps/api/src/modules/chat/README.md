# modules/chat

محادثات الطلب بين العميل والفني. جداول: chat_threads, chat_messages (قاموس §9.1-9.2). is_flagged لازم يكشف محاولات تبادل أرقام.

**الحالة: شغال (S6).**

- الخيط (`chat_thread`) بيتعمل تلقائياً لما الفني يقبل الطلب — مستمع لحدث `order.accepted` من `matching` (بره الـ transaction، زي كل الأحداث التانية في المشروع)، مش استدعاء مباشر.
- `ChatGateway` (WebSocket, namespace `/chat`): الاتصال لازم يحمل نفس JWT access token المستخدم في REST (`handshake.auth.token`). `chat:join` بيتحقق إن المستخدم فعلاً طرف في الخيط (عميل أو فني) قبل ما يخليه يدخل الـ room، و`chat:send` بيبعت `chat:message_received` لكل الأطراف فوراً.
- `contact-info-detector.ts`: كشف عملي (regex) لمحاولات تبادل أرقام موبايل — بيعلّم الرسالة (`is_flagged`) بدل ما يرفضها، عشان رسائل شرعية فيها أرقام (عناوين، مواعيد) متتحظرش.
- `GET/POST /chat/threads/:id/messages`: نفس الوظيفة عبر REST لو الكلاينت مش عايز WebSocket.
- اتعمله اختبار end-to-end فعلي بعميلين WebSocket حقيقيين (مش mock): رسالة عادية وصلت للطرفين فوراً وهي `is_flagged:false`، ورسالة فيها رقم موبايل مصري وصلت وهي `is_flagged:true`، وطرف تالت مش صاحب الخيط اترفض بـ 403 لما حاول يوصله عبر REST.
- لسه من غير: `support_chat` (شات الدعم، منفصل عن شات الطلب)، صور/مرفقات في الرسائل، قفل الخيط تلقائياً 24 ساعة بعد اكتمال الطلب (`closes_at` — محتاج حالة `completed` اللي لسه معتمدة على موديول `payments`).

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
