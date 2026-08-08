# apps/technician-app — تطبيق الفني

استقبال الطلب، قبول/رفض، ملاحة، رفع صور قبل/بعد، استلام الأرباح، طلب صرف. الستاك: **Flutter**.

## الحالة الحالية — بداية حقيقية، مش كل الميزات لسه

نفس أساس `apps/customer-app` بالظبط (كود auth منسوخ حرفياً منه، مش معاد اختراعه) — تسجيل دخول OTP كامل ضد `apps/api` الحقيقي، بنفس معمارية الأمان (`access_token` في الذاكرة، `refresh_token` في `flutter_secure_storage`، وحماية single-flight من بَقّة تدوير الـ refresh token — التفاصيل الكاملة في `apps/admin/README.md` و`apps/customer-app/README.md`).

**استقبال الطلبات** (`lib/features/orders/`): شاشة رئيسية بعد تسجيل الدخول بتعرض الطلبات المتاحة للفني (`GET /technician/orders/available`) مع مسافة كل طلب والعنوان، وأزرار قبول/رفض حقيقية (`POST /technician/orders/:id/accept|reject`).

**تنفيذ الطلب بعد القبول (`order_execution_screen.dart`, `order.dart`)**: قبول طلب بينقل لشاشة تنفيذ بتتبع دورة `order-state-machine.ts` بالظبط — زرار واحد في كل مرة (انطلقت → وصلت → ابدأ الشغل → الشغل خلص → حصّلت الكاش)، كل فعل (`POST /technician/orders/:id/depart|arrive|start|complete|collect-cash`) بيرجّع نسخة محدّثة من الطلب فتحدّث الشاشة محلياً. **ملحوظة صراحة**: مفيش `GET /technician/orders/:id` في الباك-إند حالياً (بس القراءة، مش endpoint حقيقي ناقص خطير) — يعني لو التطبيق اتقفل/اتعمله kill في نص دورة التنفيذ، الفني هيفقد شاشة التتبع دي ومفيش طريقة يرجعلها غير إعادة القبول (مش ممكن أصلاً، الطلب بقى `accepted` بالفعل) — فجوة حقيقية للاستمرارية عبر إعادة تشغيل التطبيق، موثّقة هنا صراحة مش مُتجاهلة.

نفس اكتشاف اختبار apps/customer-app بالظبط بينطبق هنا (تفاصيل كاملة في `apps/customer-app/README.md`): `test_live/technician_orders_live_test.dart` بيتحقق حياً من تسجيل دخول فني حقيقي (`user_type: technician` بالفعل) وإن `/technician/orders/available` شغال ضد الباك-إند الحقيقي. **`test_live/order_execution_live_test.dart`** بيتحقق من دورة تنفيذ كاملة وحقيقية: عميل حقيقي طلب في نطاق الفني، الفني لقى الطلب فعلاً في `/technician/orders/available`، قبله، ونفّذ كل خطوة (`depart`→`accepted` تحوّل لـ`technician_on_way`، `arrive`→`technician_arrived`، `start`→`in_progress`، `complete`→`work_completed`)، وأخيراً حصّل كاش (`payment_method: cash`, `payment_status: succeeded`) — كل خطوة اتأكد `order_status` الراجع مطابق تماماً لتسلسل `order-state-machine.ts`. الطلب اترك كسجل تجريبي كامل ومتّسق (نفس باقي الطلبات المكتملة في القاعدة التطويرية) بدل ما يتمسح جزئياً ويسيب `wallets.balance_cents` غير متّسق مع سجل المعاملات (درس اتعلّمناه من تنظيف اختبار تاني في `apps/api/src/modules/admin/README.md`). الجزء اللي لسه مش قابل للاختبار في البيئة دي هو تحديداً رندر الـ UI والتفاعل معاه (نفس السبب: `TestWidgetsFlutterBinding`) — مش منطق الشبكة/الـ auth.

**الأرباح وطلب الصرف (`lib/features/earnings/`)**: `WalletScreen` (رصيد متاح، إجمالي أرباح/مسحوب، آخر حركات المحفظة عبر `GET /wallet` + `GET /wallet/transactions`) + `PayoutRequestScreen` (مبلغ + طريقة صرف + رقم محفظة اختياري، `POST /technician/payouts`) + `PayoutsScreen` (سجل طلبات الصرف، `GET /technician/payouts`). متاحة من أيقونة في شاشة الطلبات المتاحة. **اتعمله اختبار حي حقيقي** (`test_live/earnings_live_test.dart`): فني حقيقي (نفس الفني اللي حصّل كاش في اختبار تنفيذ الطلب) شاف رصيد محفظته الحقيقي (أكبر من صفر، من أرباح حقيقية سابقة) وحركاته، طلب صرف 200 جنيه حقيقي، اتأكد إن الحالة رجعت `approved` (تحت حد الموافقة التلقائية) أو `under_review`، وإن الطلب ظهر فعلاً في `GET /technician/payouts` بعدها (عدد الصفوف زاد بالظبط واحد).

## لسه من غير — مهم إنها موثّقة صراحة قبل أي اعتماد إنتاجي

- **باقي الميزات الفعلية**: ملاحة (تتبع موقع حي عبر `OrderTrackingGateway` — الباك-إند شغال فعلاً، التطبيق لسه مش موصّله)، رفع صور قبل/بعد (`POST /technician/orders/:id/media` — الباك-إند شغال، التطبيق لسه مش موصّله).
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
