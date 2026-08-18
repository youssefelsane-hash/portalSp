# customer-web

تطبيق ويب حقيقي للعميل (Next.js 16 + React 19 + Tailwind v4) — Script 3 §58، **مش صفحة هبوط
تسويقية**. نفس الـAPIs بتاعة `apps/customer-app` (Flutter) بالحرف، بلا أي منطق أعمال مكرّر
(Script 3 §59) — كل التسعير/الحجز/الدفع منطقه في `apps/api` فقط.

## تشغيل محلي

```bash
cd apps/customer-web
npm run dev   # http://localhost:3002
```

محتاج `apps/api` شغال على `http://localhost:3000/api/v1` (القيمة الافتراضية لـ
`NEXT_PUBLIC_API_URL`).

## البنية

- **Auth**: نمط BFF (Backend-for-Frontend) مطابق لـ`apps/admin` بالحرف — Route Handlers في
  `src/app/api/auth/*` بتعبر لـ`apps/api` الحقيقي وتحطّ `refresh_token` كـhttpOnly cookie (مايوصلش
  لجافاسكريبت خالص، دفاع أساسي ضد XSS). `access_token` قصير العمر يترجع في الـJSON body ويتخزّن في
  الذاكرة بس (`src/lib/auth-context.tsx`) — مفيش `localStorage`. `authedFetch()` بيعمل محاولة
  refresh واحدة تلقائيًا لو حصل 401، بـsingle-flight (`inFlightRefresh` ref) عشان طلبين متزامنين
  ميحصلوش refresh مزدوج (يتصادم مع كشف إعادة استخدام refresh token في الباك-إند).
- **الكتالوج/البحث**: `src/lib/catalog.ts` — نفس منطق `apps/customer-app`'s
  `catalog_repository.dart`، بحث بلغة طبيعية بسيطة عبر `search_keywords` (بلا AI، docs/16 §7).
- **الحجز**: `src/app/services/[id]/page.tsx` — صفحة واحدة شاملة (حقول ديناميكية لخدمات
  formula، عناوين، جدولة، مراجعة، دفع) بدل wizard متعدد الصفحات، عشان نفس فلسفة
  `CreateOrderScreen` في Flutter (تدفق تدريجي داخل شاشة واحدة).
- **الطلبات**: `src/app/orders/` — سجل + شاشة طلب نشط (حالة إنسانية، شات حي، إلغاء، موافقة على شغل
  إضافي).
- **الشات real-time**: `src/lib/chat-socket.ts` — Socket.IO حقيقي على نفس namespace/أحداث
  `chat.gateway.ts` بالحرف (`chat:join`/`chat:message_received`/`chat:send`)، نفس القناة اللي
  `apps/customer-app`'s `chat_client.dart` بيستخدمها بالظبط. تاريخ الرسايل REST مرة واحدة وقت
  الفتح، بعد كده كله لحظي عبر السوكيت — مفيش نظام شات تاني منفصل.
- **اختيار الموقع بالخريطة**: `src/components/map-picker.tsx` — Leaflet + OpenStreetMap tiles
  (بلا مفتاح API)، دوس/اسحب لتحديد `latitude`/`longitude` الحقيقيين بدل إدخال رقمي يدوي.
- **اختيار الفني قبل الحجز**: `src/lib/technicians.ts` + قسم "مين يعمل الشغل؟" في
  `services/[id]/page.tsx` — "خلي صُنّاع يختار" (افتراضي/أساسي) مقابل "اختار بنفسك" (ثانوي، بيفتح
  قايمة فنيين حقيقية بالسعر والتقييم لكل واحد، `GET /services/:id/technicians`) — مطابق لبند
  32-35 من سبيسفيكيشن Script 3 بالحرف.

## فجوات موثّقة صراحة (مش سهو)

- **@baytak/shared-types**: مش مستخدمة هنا عمدًا (أنواع محلية في `src/lib/api-types.ts` بدل كده) —
  تفادي تعقيد workspace linking لأول نسخة، نفس فلسفة `apps/customer-app`'s نماذج Dart المستقلة.
  أي تعديل في عقد الباك-إند لازم ينعكس هنا يدويًا.
- **بلاطات الخريطة (map tiles) في بيئة التطوير الحالية**: `tile.openstreetmap.org` اتحجب فعليًا في
  بيئة الـsandbox بتاعة الـagent وقت الاختبار الحي (بروكسي صارم، `ERR_TUNNEL_CONNECTION_FAILED`) —
  اتأكد إن ده قيد الشبكة بتاع بيئة الاختبار نفسها (`curl "$HTTPS_PROXY/__agentproxy/status"`)، مش
  بَقّة كود: تفاعل الخريطة (كليك/سحب/التقاط الإحداثيات) اتأكد حي بالكامل والماركر بيتحط صح، بس
  الخلفية المرئية (البلاطات) فاضية سوداء/رمادية في السكرين شوت في البيئة دي بس. متصفح حقيقي غير
  مقيّد (المستخدم النهائي) هيحمّل البلاطات عادي، `tile.openstreetmap.org` خدمة عامة قياسية بلا
  مفتاح.

تفاصيل كاملة إضافية: `docs/16-script-3-customer-ux-delta-report.md`.
