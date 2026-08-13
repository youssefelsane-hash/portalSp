# modules/auth

التسجيل، OTP، JWT + refresh token rotation، RBAC. جداول: users, otp_codes, refresh_tokens, roles, permissions, role_permissions, user_roles (قاموس §2).

- **`DELETE /auth/me` (`deleteMe`)**: حذف الحساب الذاتي — إلغاء كل التوكنات، `is_active=false`، بعدين `softDelete` على `users`. نفس التسلسل ده اتّبعته `AdminEmployeesService.delete()` (`../admin/admin-employees.service.ts`) لحذف حساب موظف، وده اللي كشف بَقّة حقيقية موثّقة تحت.
- **بَقّة حقيقية اتلقطت واتصلحت (`infra/migrations/0035`)**: `users_phone_number_key`/`users_email_key`/`users_referral_code_key` كانوا `UNIQUE` عادي على العمود كله (من `0003_auth.sql`) — بيشمل الصفوف المحذوفة (`deleted_at IS NOT NULL`)، عكس `idx_users_phone_number`/`idx_users_referral_code` (من نفس الملف) اللي كانوا partial بالفعل (`WHERE deleted_at IS NULL`). النتيجة: أي حساب اتعمله `softDelete` (سواء عبر `deleteMe` الذاتي أو حذف موظف من الإدارة) كان بيقفل رقمه/إيميله للأبد — أي تسجيل جديد بنفس القيمة بيرمي `duplicate key violation` خام (500) بدل رفض نضيف. اتصلحت باستبدال الثلاث قيود بـ partial unique index واحد لكل عمود. اتأكد الإصلاح حياً عبر `../admin/README.md` (قسم إدارة الموظفين).
- **إرسال OTP بـ SMS حقيقي — كان `TODO` ثابت من أول يوم ("بيتسجل بس في اللوج للتطوير المحلي")، اتقفل**: `AuthService.requestOtp()` بقى بينادي `TwilioSmsDispatcher` (`common/notifications/`, نفس البوابة اللي `notifications` موديول بيستخدمها لقنوات SMS العادية) بعد ما يسجّل الكود في اللوج زي ما هو — الاتنين مع بعض عمداً، مش بديل واحد للتاني: اللوج المحلي فاضل موجود دايماً عشان الاختبارات الحية والتطوير المحلي يقدروا يقرأوا الكود من غير SMS حقيقي، وSMS الحقيقي بيتحاول لو `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_SMS_FROM_NUMBER` مظبوطين. فشل الإرسال (بوابة مش مظبوطة أو خطأ شبكة) بيتسجّل تحذير بس ومبيرمّيش الطلب — العميل لسه يقدر يكمل. اتأكد حياً: `POST /auth/otp/request` رجّع `200` عادي، اللوج المحلي فيه الكود زي ما هو دايماً، وسجّل تحذير واضح "لا توجد بوابة SMS مُعدّة" (Twilio مش مظبوط في البيئة دي) من غير ما يأثر على نجاح الطلب أو على أي اختبار حي تاني في المشروع كله (كلهم بيعتمدوا على قراءة اللوج ده بالظبط).
  - **بَقّة أمنية حقيقية اتلقطت واتصلحت (مراجعة أمان شاملة 2026-08-13، P0-4)**: اللوج ده كان بيسجّل
    الكود الفعلي **دايمًا بلا شرط** — مناسب تمامًا للتطوير المحلي، لكن خطر حقيقي لو `NODE_ENV=production`
    (أي حد عنده access للوجز الإنتاج يقدر ياخد أي كود OTP ويدخل أي حساب مباشرة). الإصلاح: الكود
    الفعلي بيظهر بس لو `NODE_ENV≠production` (زي كل بيئات التطوير/الاختبار المحلي، بما فيها CI) —
    في Production بيتسجّل بدله رقم موبايل مقنّع (أول 5 أرقام + آخر رقمين بس، من غير الكود خالص)
    عبر `Logger` العادي. اختبار regression حي في `auth.service.spec.ts` بيبني `AuthService` بـ
    `NODE_ENV=production` صريح ويثبت إن `console.log` ما يتصداش أبداً بنمط `[OTP] ... → 123456`.

- **نظام الترشيحات — تفعيل `users.referral_code`/`referred_by_user_id`**: كانوا أعمدة موجودة من `0003_auth.sql` بس مش مستخدمين. `register()` بقى يولّد `referral_code` فريد (6 أحرف، استبعاد 0/O/1/I) لكل مستخدم جديد تلقائياً، وبيقبل `referral_code` اختياري في `RegisterDto` — لو اتبعت وغلط بيترفض بـ`VAL_001` واضح مش تجاهل صامت. توليد الكود وقراءته بيحصلوا هنا مباشرة (مش عبر حقن `ReferralsService`) لأن العمودين دول على `users` اللي `auth` بيتحكم فيه لوحده — إنشاء صف `referrals` المعلّق نفسه مسؤولية موديول `referrals` (بيستقبل `REFERRAL_REGISTERED_EVENT`). تفاصيل كاملة: `../referrals/README.md`.

## `refresh()` بقت ذرّية فعليًا — كانت بَقّة أمنية موثّقة في `apps/admin/README.md`، اتقفلت (P0-5)

`AuthService.refresh()` كانت بتقرأ صف `refresh_tokens` بـ`findOne` عادي (من غير قفل)، تفحصه في
الذاكرة، وتكتب `isRevoked=true` بعد كده — بلا transaction ولا `SELECT ... FOR UPDATE`. تحقيق حي
سابق (`apps/admin/README.md`§ "فجوة السباق عبر التابات") أثبت فعليًا إن طلبين `refresh()` متزامنين
بنفس التوكن تحت READ COMMITTED كانوا الاتنين يقدروا يقروا `isRevoked=false` قبل ما أي واحد يكتب،
فيعدّوا الاتنين ويصدروا **زوج توكنز صالح لكل واحد فيهم** — إصدار جلستين من توكن واحد بدل رفض واحد
منهم. `apps/admin`'s Web Locks API كان تخفيف على مستوى الـclient بس (تاب واحد/متصفح واحد)، الجذر
في الباك-إند فضل موجود لأي عميل تاني (Flutter، سكريبت خارجي).

**الإصلاح**: نفس نمط `pessimistic_write` جوّه `dataSource.transaction()` المستخدم في
`matching.service.ts`'s `accept()`/`permissions.service.ts`'s `setRolePermissions()` — قفل صف
التوكن من أول خطوة، فأي نداء تاني بيستنى القفل يتفك وبعدين يلاقي `isRevoked=true` فعلاً ويترفض
بأمان (`AUTH_001`). `issueTokenPair()` بقت تاخد `manager` اختياري (نفس نمط `WalletsService.doubleEntry()`)
عشان إصدار الزوج الجديد يحصل جوّه نفس الـtransaction الماسكة القفل.

**اختبار regression حي ضد قفل Postgres حقيقي** (`refresh-token-rotation.spec.ts` — الاختبار
الوهمي في `auth.service.spec.ts` مايقدرش يثبت ده لأنه مالوش قفل صفوف حقيقي): نداءين `refresh()`
متزامنين فعليًا (`Promise.allSettled`) بنفس التوكن — **واحد بس نجح**، التاني اترفض `AUTH_001`
بوضوح، وصف واحد بس فضل `is_revoked=false` في النهاية (مش اتنين، السلوك القديم قبل الإصلاح).

## `JwtStrategy` بقت بتفحص الحساب حي — كانت فجوة موثّقة في `admin/README.md`، اتقفلت (P0-6)

`validate()` كانت بترجّع الـpayload (`{sub, userType}`) بلا أي فحص قاعدة بيانات — يعني حظر/تعطيل/
حذف حساب (عميل، فني، أدمن — أي نوع) كان يفضل مالوش أثر على `access_token` لسه ساري (أقصى مدة
15 دقيقة) لحد ما ينتهي أو يحاول `refresh`. `PermissionsGuard` كانت بتتحقق حياً لأي فعل إداري محمي
بصلاحية دقيقة، لكن أي فعل مفتوح (زي `GET` عادي لعميل/فني) كان بيفضل شغال بالتوكن القديم كامل.

**الإصلاح**: `validate()` بقت `async` وبتعمل قراءة واحدة بالمفتاح الأساسي على `users` (`is_blocked`/
`is_active`/`deleted_at` — الأخير بيتفلتر تلقائيًا لأن `User` عليها `@DeleteDateColumn`، مفيش حاجة
إضافية مطلوبة) — لو أي شرط اتحقق، `UnauthorizedException` واضح فورًا. مفيش cache هنا عمداً: الهدف
الأساسي "فورية" الحظر، وكاش حتى بمدة قصيرة كان هيعيد فتح نفس الفجوة بحجم أصغر بلا داعي حقيقي
للأداء دلوقتي (قراءة PK واحدة على كل طلب مش مكلفة).

**اختبار regression حي** (`jwt-strategy-active-user-check.spec.ts`): مستخدم نشط عادي يعدّي زي ما
هو (السلوك الأصلي محفوظ)، مستخدم محظور/معطّل/محذوف الثلاثة بيترفضوا فورًا، ومستخدم `sub` مش موجود
خالص بيترفض بأمان (`UnauthorizedException`، مش استثناء غير متوقّع).

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
