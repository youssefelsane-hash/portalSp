# apps/technician-app — تطبيق الفني

استقبال الطلب، قبول/رفض، ملاحة، رفع صور قبل/بعد، استلام الأرباح، طلب صرف. الستاك: **Flutter**.

## الحالة الحالية — بداية حقيقية، مش كل الميزات لسه

نفس أساس `apps/customer-app` بالظبط (كود auth منسوخ حرفياً منه، مش معاد اختراعه) — تسجيل دخول OTP كامل ضد `apps/api` الحقيقي، بنفس معمارية الأمان (`access_token` في الذاكرة، `refresh_token` في `flutter_secure_storage`، وحماية single-flight من بَقّة تدوير الـ refresh token — التفاصيل الكاملة في `apps/admin/README.md` و`apps/customer-app/README.md`).

**استقبال الطلبات** (`lib/features/orders/`): شاشة رئيسية بعد تسجيل الدخول بتعرض الطلبات المتاحة للفني (`GET /technician/orders/available`) مع مسافة كل طلب والعنوان، وأزرار قبول/رفض حقيقية (`POST /technician/orders/:id/accept|reject`).

نفس اكتشاف اختبار apps/customer-app بالظبط بينطبق هنا (تفاصيل كاملة في `apps/customer-app/README.md`): `test_live/technician_orders_live_test.dart` بيتحقق حياً من تسجيل دخول فني حقيقي (`user_type: technician` بالفعل) وإن `/technician/orders/available` شغال ضد الباك-إند الحقيقي. الجزء اللي لسه مش قابل للاختبار في البيئة دي هو تحديداً رندر الـ UI والتفاعل معاه (نفس السبب: `TestWidgetsFlutterBinding`) — مش منطق الشبكة/الـ auth.

## لسه من غير — مهم إنها موثّقة صراحة قبل أي اعتماد إنتاجي

- **باقي الميزات الفعلية**: ملاحة، رفع صور قبل/بعد، الأرباح، طلب الصرف.
- **متطلبات الأمان الإلزامية من `docs/01-master-plan.md` §7.3 — لسه صفر، مش اختيارية**:
  - **SSL pinning** — التطبيق ده بيتعامل مع بيانات مالية حساسة (أرباح، صرف)، فمينفعش يعتمد على التحقق الافتراضي من الشهادة بس.
  - **كشف الأجهزة المكسورة (root/jailbreak)** — لازم قبل السماح بأي عملية مالية.
  - **منع mock location** — حرج جداً هنا تحديداً: تتبع موقع الفني الحقيقي أساس نظام الـ matching والدفع، وmock location ممكن يتلاعب بيه فني عشان ياخد طلبات مش في نطاقه الحقيقي أو يزوّر إثبات الوصول لمكان الخدمة.

المتطلبات التلاتة دي **قبل أي إطلاق حقيقي للتطبيق ده**، مش بعده — موثّقة هنا عشان محدش يفترض إنها اتعملت لمجرد إن الـ auth شغال.

## التشغيل محلياً (على جهاز فيه Android/iOS toolchain حقيقي)

```bash
cd apps/technician-app
flutter pub get
flutter run --dart-define=API_BASE_URL=http://<عنوان الباك-إند>/api/v1
```

مرجع كامل: `../../docs/01-master-plan.md`
