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
- **الطلبات**: `src/app/orders/` — سجل + شاشة طلب نشط (حالة إنسانية، شات، إلغاء، موافقة على شغل
  إضافي).

## فجوات موثّقة صراحة (مش سهو)

- **الشات real-time**: بولينج كل 5 ثواني (`src/app/orders/[id]/page.tsx`'s `ChatSection`)، مش
  WebSocket حقيقي زي الموبايل (Socket.IO). نفس الـREST endpoints بالظبط، بس من غير بث لحظي.
- **اختيار الموقع بالخريطة**: إدخال `latitude`/`longitude` يدوي في فورم العنوان الجديد
  (`services/[id]/page.tsx`'s `NewAddressForm`) — مفيش map picker حقيقي بعد.
- **اختيار الفني قبل الحجز**: الموبايل عنده شاشة بحث/مقارنة فنيين كاملة (`apps/customer-app`)،
  الويب لسه بيعتمد على المطابقة التلقائية بس (auto-match). لو العميل محتاج يختار فني بعينه، محتاج
  الموبايل حاليًا.
- **@baytak/shared-types**: مش مستخدمة هنا عمدًا (أنواع محلية في `src/lib/api-types.ts` بدل كده) —
  تفادي تعقيد workspace linking لأول نسخة، نفس فلسفة `apps/customer-app`'s نماذج Dart المستقلة.
  أي تعديل في عقد الباك-إند لازم ينعكس هنا يدويًا.

تفاصيل كاملة إضافية: `docs/16-script-3-customer-ux-delta-report.md`.
