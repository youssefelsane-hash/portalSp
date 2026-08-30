# modules/auth

التسجيل، OTP، JWT + refresh token rotation، RBAC. جداول: users, otp_codes, refresh_tokens, roles, permissions, role_permissions, user_roles (قاموس §2).

## Script 2: OTP والتسجيل الذري

- إصدار كود بديل يأخذ advisory lock حسب `(phone_number, purpose)`، يبطل كل الأكواد السابقة، ثم
  ينشئ كودًا واحدًا أحدث داخل transaction. استهلاك الكود يقفل أحدث صف غير مستخدم بـ
  `SELECT ... FOR UPDATE`، لذلك لا يمكن لطلبين متزامنين النجاح بنفس الكود.
- المحاولة الخاطئة ترجع كـنتيجة متوقعة من داخل transaction ثم يُرمى خطأ API بعد الـcommit؛ بذلك
  لا يعمل الاستثناء rollback لزيادة `attempts_count`. الحد الأقصى يظل فعالًا حتى تحت التزامن.
- التسجيل يستهلك OTP الصحيح وينشئ `users` والبروفايل الخاص بالنوع والمحفظة وrefresh token في
  transaction واحدة. فشل أي خطوة يرجع الجميع، بما في ذلك استهلاك OTP، فلا يوجد حساب نشط ناقص.
- أرقام الهاتف تُحوّل إلى E.164 قبل التحقق في جميع DTOs الخاصة بالطلب والتسجيل والدخول والاسترجاع.
  التسجيل والدخول لهما rate limits صريحة، وكود OTP لا يظهر مطلقًا في production logs.
- كل مسارات إصدار جلسة (`login`, `passwordless`, إكمال MFA، و`refresh`) ترفض الحساب غير النشط أو
  المحظور. التحقق من sockets النشطة واستدعاء الفصل الفوري موثق ويُنفذ في مرحلة realtime التالية.

الإثبات الحي في `otp-registration-integrity.spec.ts`: reuse، wrong-attempt concurrency، resend ×
verify، expiry، rollback بحقن فشل، baseline لكل الأنواع، ورفض الحساب غير النشط. الفهرس الجزئي
`idx_otp_codes_latest_unused` مضاف في migration `0122`.

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

## MFA/Passkeys إجباري لكل الحسابات عالية الصلاحية — ADR-0011 Phase 1 (Backend كامل، 2026-08-13)

طلب صريح من المالك بعد مراجعة أمان مفصّلة: أي حساب أدمن يقدر يشوف/يتحكم في الفلوس أو يغيّر
Roles/Permissions **لازم** MFA (WebAuthn/Passkeys، مش SMS/OTP لوحدها) إجباري عليه — من البداية
لكل الأدوار عالية الصلاحية دفعة واحدة، مش Super Admin بس. التصميم الكامل والبدائل اللي اتقيّمت
ورُفضت موثّقة في `../../../../docs/adr/0011-admin-mfa-passkeys.md` — الملخص التنفيذي هنا.

### التعريف الحي لـ"High-Privilege" — مش قايمة أدوار ثابتة

`MfaPolicyService.userRequiresMfa()` بتفحص صلاحيات المستخدم الفعلية حية (`PermissionsService.
getUserPermissionNames()`) ضد `MFA_REQUIRED_PERMISSIONS` (`refunds.issue`, `payouts.approve`,
`orders.adjust_price`, `roles.manage`, `roles.grant_unrestricted`, `settings.manage`) — أو
`is_super_admin` (بيتخطى فحص الصلاحيات بالكامل، ADR-0010). دور جديد يتمنح أي صلاحية من دول بعدين
بيبقى ملزَم MFA فورًا من غير أي تعديل كود. اليوم ده بيغطي فعليًا `super_admin`، `finance`
(`refunds.issue`+`payouts.approve`)، `ops_manager` (`orders.adjust_price`) — مؤكّد بفحص حي.

**بَقّة حقيقية اتلقطت أثناء البناء (قبل أي اختبار حي)**: القايمة الأولى كانت فيها `payments.refund`
— اسم صلاحية مش موجود في الكتالوج الفعلي خالص (الاسم الحقيقي `refunds.issue`، اتأكد بفحص جدول
`permissions` مباشرة). كان النتيجة العملية إن دور بصلاحية `refunds.issue` بس (من غير `payouts.
approve`) ميتفرضش عليه MFA رغم قدرته يعمل استرداد فلوس فعلي — اتصلحت قبل أي commit.

### تسجيل الدخول — فرع MFA قبل إصدار التوكن النهائي

`AuthService.login()` زي ما هو (OTP هو الخطوة الأولى لأي نوع حساب، صفر تغيير). بعد نجاح OTP، لو
`userRequiresMfa()` رجعت `true`: مفيش تسجيل توكن نهائي — بدل كده `mfa_pending` JWT قصير (5 دقايق،
`typ: 'mfa_pending'`، موقّع بـ`jwt.refreshSecret` الموجود بالفعل مش سرّ جديد) + `ceremony:
'registration'` (أول مرة، مفيش Passkey لسه) أو `'authentication'` (عنده Passkey بالفعل). العميل
بعدها بيكمّل ceremony الـWebAuthn المناسبة ضد `/auth/webauthn/*`، وبس لما تنجح فعليًا
`AuthService.completeMfaLogin()` بتصدر التوكن الحقيقي بـ`amr: ['otp','webauthn']`.

**دخول سريع يومي بـPasskey بس** (`POST /auth/webauthn/authentication/{options,verify}` من غير
`mfa_session_token` خالص) — discoverable credential كامل، السيرفر بيعرف هوية المستخدم من
`userHandle` الرد نفسه، **وبرضه بيتحقق `is_blocked`/`is_active` حي** (نفس طلب المالك بالحرف: راحة
الدخول اليومي مش على حساب فحص حالة الحساب) — `amr: ['webauthn']`.

### Step-up re-authentication — عملية حساسة تحتاج Passkey حديث فعلاً وقتها

`StepUpToken` (Postgres، مش Redis — قرار أمني متعمّد، شوف تحت) TTL دقيقتين، single-use، استهلاك
ذرّي بـ`UPDATE ... WHERE used_at IS NULL AND expires_at > now() RETURNING id`. العميل يطلب
`POST /auth/webauthn/step-up/{options,verify}` (Passkey فعلي تاني، مش أي حاجة مخزّنة من الجلسة)،
يستلم `step_up_token`، يبعته في هيدر `X-Step-Up-Token` للعملية الحساسة. `StepUpGuard` (5ه `APP_GUARD`
عالمي جوّه `app.module.ts`، بعد `PermissionsGuard`) — no-op تمامًا إلا لو `@RequireStepUp()` موجود
على الـmethod (نفس نمط `@RequirePermission`/`PermissionsGuard` بالحرف).

**قرار أمني اتصحّح ذاتيًا قبل ما يتكتب أي كود**: التصميم الأول كان Redis لتتبّع استهلاك التوكن
(أبسط، مفيش migration). لكن فلسفة `RedisCacheService` الموثّقة ("أي فشل Redis = safe cache miss")
صح تمامًا لكاش أداء، **غلط وخطير** لفحص أمني single-use — انقطاع Redis كان هيخلي كل step-up token
"يبان إنه متستخدمش قبل كده" = ثغرة إعادة استخدام حقيقية وقت بالظبط نفس نوع العطل اللي المشروع
اتحرق منه قبل كده (فجوة BullMQ/Redis الموثّقة في `technicians/README.md`). التصحيح: `step_up_tokens`
في Postgres — fail-closed (عطل DB بيمنع العملية الحساسة بالكامل، ده السلوك الآمن).

`@RequireStepUp()` مُطبّق فعليًا على: `/auth/webauthn/credentials/:id` (مسح Passkey)،
`/auth/sessions/revoke-all`، `/admin/users/:id/mfa/reset`، `/admin/orders/:id/refund`،
`/admin/payouts/:id/{approve,complete}`، وكل الـendpoints المُغيّرة في role builder (`POST/PATCH/
DELETE /admin/roles*`, `PUT /admin/roles/:id/permissions`, `POST/DELETE /admin/users/:userId/roles`).
**قرار متعمّد بالاستبعاد**: `feature-flags` (`/admin/feature-flags/*`) اتقيّم واتأجّل — `feature_flags.
manage` مش في `MFA_REQUIRED_PERMISSIONS`، فأدمن عنده الصلاحية دي بس (من غير أي صلاحية تانية من
القايمة) ممكن يكون مسجّلش Passkey خالص — فرض step-up عليه كان هيقفله برّه الـendpoint نهائيًا
(معندوش Passkey يثبت بيه step-up). نفس السبب استبعد `AdminEmployeesController.create()` رغم إنه
نظريًا يقدر يمنح `super_admin` وقت الإنشاء (`initial_role_name` مش مقيّد) — فحص دقيق يميّز "موظف
عادي" عن "منح super_admin" محتاج منطق service-layer إضافي مش مجرد decorator على الـcontroller،
مؤجّل لمرحلة تانية وموثّق هنا كفجوة معروفة صراحة.

### إدارة الأجهزة/الجلسات

`refresh_tokens.device_id/device_name/device_platform` (موجودين من زمان، فاضيين) + أعمدة جديدة
`last_seen_at`/`user_agent`/`amr` (JSONB، افتراضي `["otp"]`، بينتقل مع الجلسة عبر `refresh()` مش
بيترجع لـotp بصمت). `GET /auth/sessions` (قايمة)، `DELETE /auth/sessions/:id` (إلغاء واحدة)،
`POST /auth/sessions/revoke-all` (`@RequireStepUp()`). **قرار مرفوض بالاسم**: إعادة استخدام
`user_devices` (موديول notifications، FCM push tokens) — دورة حياة مختلفة تمامًا، خلط المفهومين
كان هيكسر منطق FCM الموجود ومختبر بالفعل.

### الاسترجاع — OTP + recovery code سويًا، عاملين مستقلين، مفيش عامل ضعيف واحد كافي

10 أكواد استرجاع (`XXXX-XXXX-XXXX`، bcrypt-hashed) بتتولّد مرة واحدة لحظة تسجيل أول Passkey للمستخدم
وتتعرض مرة واحدة بس. `POST /auth/recovery/verify` (OTP + recovery code سويًا) — لو نجح: كل
الـPasskeys/أكواد الاسترجاع القديمة بتتمسح بالكامل، كل الجلسات القديمة بتتلغي
(`revokeAllUserTokens(..., 'mfa_recovery')`)، تصعيد أمني فوري لـ`super_admin` عبر
`NotificationRoutingService.routeToRole('admin_mfa.recovery_used', ...)`، والرد بيرجع نفس شكل
`mfa_required: true, ceremony: 'registration'` العادي — إجبار enrollment كامل تاني، مفيش رد خاص
منفصل. لو الـ10 أكواد اتستهلكوا كلهم من غير استخدام: التعافي محتاج تدخّل يدوي من `super_admin`
تاني عبر `POST /admin/users/:id/mfa/reset` (`roles.manage` + `@RequireStepUp()`، بيمسح
`webauthn_credentials`/`admin_mfa_recovery_codes` بتاعة المستخدم المتأثر، مسجّل بـ`audit_logs`).

### بَقّة حقيقية تانية اتلقطت واتصلحت أثناء الاختبار الحي (مش نظريًا)

`MfaSessionTokenDto` المحلية في `webauthn.controller.ts` كانت `mfa_session_token?: string;` من غير
أي decorator. الـ`ValidationPipe` العالمي شغّال بـ`whitelist: true, forbidNonWhitelisted: true` —
class-validator/class-transformer بيتجاهلوا أي property من غير decorator خالص حتى لو متعرّفة على
الكلاس، فالنتيجة كانت `property mfa_session_token should not exist` لأي طلب فعلي — الميزة كانت
هتترفض 100% من أول استخدام حقيقي رغم إن كل الاختبارات النظرية/الكومبايل عدّت. اتلقطت بس لما اتعمل
اختبار حي فعلي بـ`curl` ضد السيرفر شغال، مش بـ`tsc`/`jest`. الإصلاح: `@IsOptional() @IsString()`
على الحقل، زي أي DTO تاني في المشروع.

### اختبار حي (2026-08-13، ضد Postgres/Redis حقيقيين، حسابات أدمن حقيقية موجودة بالفعل)

- تسجيل دخول حساب `finance` (`refunds.issue`+`payouts.approve`) → `mfa_required: true, ceremony:
  'registration'` صح (مفيش Passkey لسه).
- تسجيل دخول حساب `support_agent` (مفيهوش أي صلاحية من القايمة) → توكن عادي فورًا، `amr: ['otp']`،
  صفر تغيير سلوكي.
- `mfa_session_token` صحيح → `registration/options` بترجّع WebAuthn challenge حقيقي صالح
  (`rp.id`, `pubKeyCredParams`, `authenticatorSelection.residentKey: 'required'`, إلخ).
  `mfa_session_token` تالف/غير موجود → `AUTH_005` واضح في الحالتين.
  (البَقّة فوق اتلقطت واتصلحت هنا بالظبط.)
- `POST /auth/sessions/revoke-all` من غير هيدر `X-Step-Up-Token` → `AUTH_006` (`StepUpGuard`
  شغّال فعليًا كـglobal guard).
  `POST /admin/users/:userId/roles` بحساب مالوش `roles.manage` أصلاً → `AUTH_001` (فحص الصلاحية
  بيسبق فحص step-up في ترتيب الـguards، زي المتوقع).
- `GET /auth/sessions` مع `device_id`/`device_name`/`device_platform` مبعوتين وقت الدخول → متسجّلين
  ومترجّعين صح، `last_seen_at` بيتحدّث للجلسات الجديدة.
- تشغيل السيرفر كامل (`nest build` + `start:dev`) بعد الـwiring — لقطت فجوتين حقيقيتين في
  DI (`AuthModule` مكنش بيصدّر `StepUpService`، فـ`StepUpGuard` كـ`APP_GUARD` عالمي في
  `AppModule` كان مايلاقيهوش) — اتصلحوا فورًا (`exports: [AuthService, StepUpService]`).

**نطاق مؤجّل صراحة لـPhase 2** (زي محرك التسعير: Backend يثبت الأول): واجهة `apps/admin` (تسجيل
Passkey، شاشة الأجهزة/الجلسات، step-up prompt وقت العمليات الحساسة، شاشة عرض recovery codes مرة
واحدة). Face ID/بصمة للعميل/الفني (`local_auth` Flutter) غير ذي صلة بالـADR ده خالص — تقنية مختلفة.
اختبار WebAuthn ceremony الفعلية end-to-end (تسجيل/تحقق Passkey حقيقي) محتاج virtual authenticator
(Playwright + CDP WebAuthn domain) أو جهاز فعلي — مؤجّل، مش جزء من الاختبار الحي اللي اتعمل هنا.

## §106 — «الكود بيظهر في الترمينال بس بيترفض»: ليه بيحصل وإيه اللي اتعمل (بلاغ مالك، 2026-08-30)

**البلاغ**: الكود بيتطبع في ترمينال الـAPI، وأول ما يتدخّل في تطبيق العميل/الفني بيرجّع «الصلاحية
منتهية أو غير صالح».

**التشخيص الحي** (curl ضد Postgres/Redis حقيقيين): مسار الدخول نفسه سليم بالكامل —
`otp/request` → قراية الكود من اللوج → `otp/verify` → توكن → `GET /auth/me` بيعدّي كله. البَقّة
إن **الكود اللي في الترمينال مش بالضرورة الكود اللي السيرفر بيقبله**:

- `requestOtp()` بيعمل `UPDATE ... SET is_used = true` لكل الأكواد غير المستهلكة لنفس
  (الرقم + الغرض) **قبل** ما يصدر الجديد. الكود القديم بيموت في نفس اللحظة.
- `consumeOtpLocked()` بياخد **أحدث صف غير مستهلك بالضبط** لنفس (الرقم + الغرض).
- الترمينال في المقابل stream مالوش ذاكرة — بيطبع كل كود اتصدر في حياة العملية، لكل رقم، لكل
  غرض، من كل تطبيق، من غير أي إشارة إن السطر ده اتلغى.

فأي واحدة من دول بتطلّع نفس الشكوى بالظبط: ضغط «ابعت كود» مرتين، أو كود `register` اتدخّل في
مسار `login` (أو العكس)، أو عدّى أكتر من `OTP_EXPIRY_MINUTES`، أو سطر بتاع رقم/تطبيق تاني.

**اللي اتعمل**:

1. `consumeOtpLocked()` بقى بيفرّق بين ثلاث حالات بدل رسالة واحدة مبهمة:
   - مفيش كود صالح / منتهي → «اضغط ابعت الكود تاني».
   - الأرقام مطابقة لكود **اتلغى بكود أحدث** (`matchesSupersededCode()`) → «الكود ده اتلغى لما
     طلبت كود جديد — استخدم آخر كود وصلك». دي بالظبط حالة المالك، وكانت بتطلع «الكود غلط».
   - غير كده → «الكود غلط» + عدد المحاولات الفاضلة.
2. سطر لوج التطوير بقى بيقول الكود صالح لحد إمتى وإنه لغى اللي قبله. **الكود لازم يفضل آخر توكن
   بعد `→`** — كل سكريبتات `apps/*/test_live/*.dart` وauth.service.spec.ts بتستخرجه بـ
   `split('→').last`، فأي إضافة تتحط قبل السهم.
3. زرار «ابعت الكود تاني» بعدّاد ٣٠ ثانية اتضاف في تطبيق العميل، تطبيق الفني، وصفحتي
   `login`/`register` في customer-web — الطريق المسدود اتقفل (قبل كده مكانش فيه إعادة إرسال
   أصلاً، المخرج الوحيد كان «رجّع خطوة»/«غيّر الرقم»).

**قرار أمني صريح — ترتيب `login()` ما اتغيرش**: استهلاك الكود بيفضل **قبل** التأكد إن الرقم
مسجّل. تقديم فحص وجود المستخدم كان هيوفّر الكود في حالة الرقم غير المسجّل، لكنه بيحوّل
`POST /auth/otp/verify` لأداة **تعداد حسابات مجانية** (٦ أرقام عشوائية بتكفي للتفرقة بين «الرقم
مش مسجل» و«الكود غلط»). دلوقتي لازم يكون معاه كود صحيح فعلاً. حالة المستخدم الحقيقي اتحلّت من
ناحية التطبيق (تحويل لمود التسجيل + كود جديد) مش بتنازل أمني.

`matchesSupersededCode()` بيراجع آخر ٣ أكواد بس (`SUPERSEDED_OTP_LOOKBACK`) وعلى مسار الفشل
فقط — كل صف = `bcrypt.compare` كاملة، فالحد ده مقصود عشان الفحص مايبقاش أتقل من التحقق نفسه.
ورصيد المحاولات بيتخصم عادي قبله، فمفيش أي توسيع في مساحة التخمين.

التغطية: `otp-failure-diagnostics.spec.ts` (٦ اختبارات ضد Postgres حقيقي) بتثبّت الحالات دي كلها
+ إن سطر اللوج فضل قابل للاستخراج.
