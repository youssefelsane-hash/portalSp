# ADR-0011: ترقية أمان دخول الأدمن — WebAuthn/Passkeys + MFA + Step-up Authentication

**الحالة:** معتمد (Phase 1 — Backend كامل: تسجيل/تحقق Passkey، فرض MFA على الدخول، step-up، إدارة جلسات، استرجاع)
**التاريخ:** 2026-08-13

## السياق

`docs/08` §14 سجّل طلب صريح من المالك: نظام الدخول الحالي (رقم موبايل + OTP بس) لكل الأدوار
بما فيها Super Admin **مش كافي** لحسابات إدارية عالية الصلاحية. الطلب (النص الرسمي مسجّل بالحرف
في `docs/08` §14) يطلب MFA حقيقي مقاوم للـphishing (يُفضَّل WebAuthn/Passkeys)، step-up
re-authentication للعمليات الحساسة، إدارة أجهزة/جلسات، وrecovery قوي مايرجعش لعامل واحد ضعيف
(زي SMS بس). **قرار عمل صريح لاحق من المالك (نفس اليوم)**: النطاق كامل من أول يوم — أي حساب
يقدر "يشوف/يتحكم في الفلوس أو يغير Roles/Permissions" — مش Super Admin بس، ومفيش Phase تدريجي
بالدور.

**الوضع الحالي (اتفحص كامل قبل التصميم)**: `AuthService.login()` مسار واحد لكل `user_type` —
مفيش أي تفرقة "أدمن محتاج تحقق أقوى" خالص. `JwtStrategy.validate()` بيعمل فحص حي (مفيش cache)
لـ`is_blocked`/`is_active` على كل request — **فلسفة "no cache, deliberately" دي لازم تتبع في أي
فحص MFA جديد كمان**. `PermissionsGuard`/`PermissionsService.getUserPermissionNames()` بيرجّعوا
مجموعة صلاحيات المستخدم الفعلية حية (مفيش cache)، و`is_super_admin` بيتخطى الـjoin بالكامل
(عمود على `Role` مش صف في `permissions`). `refresh_tokens` (`AuthService.refresh()`) عنده
transaction ذرّية (`pessimistic_write`) بترفض إعادة استخدام توكن ملغي وتُبطل كل توكنات المستخدم
فورًا لو حصل ("security_breach") — **نفس النمط ده هيتبع لأي عملية جديدة محتاجة ذرّية** (تسجيل
credential، استهلاك تحدي WebAuthن). `refresh_tokens` عنده أعمدة `device_id`/`device_name`/
`device_platform` **موجودة من قبل بس مش متعبّية خالص** — مفيش أي DTO بيبعتها. جدول `user_devices`
(موديول `notifications`) **موجود ومختلف تمامًا** — ده لـFCM push tokens بس، **ممنوع** إعادة
استخدام الاسم ده أو نفس الجدول لمفهوم "جهاز موثوق لـMFA" (دورة حياة مختلفة تمامًا: توكن push
بيتغير كل تثبيت تطبيق، credential الـWebAuthn تشفيري وثابت مربوط بالمصادِق الفعلي/الجهاز).

## القرار

### 1. تعريف "High-Privilege" — ديناميكي بالصلاحية، مسجّل بالفعل في `docs/08` §14

`MFA_REQUIRED_PERMISSIONS` (ثابت في الكود، بس الفحص نفسه حي وقت الطلب — نفس فلسفة `PermissionsGuard`):
```
payments.refund, payouts.approve, orders.adjust_price,
roles.manage, roles.grant_unrestricted, settings.manage
```
زائد `is_super_admin=true` (بيتخطى الفحص، يُعامل تلقائيًا كأنه حائز كل حاجة فوق). دالة واحدة
`MfaPolicyService.userRequiresMfa(userId)` — بتنادي `PermissionsService.getUserPermissionNames(userId)`
**مرة واحدة** (مش N نداء لكل صلاحية) وتفحص `some()` على المجموعة الثابتة، بالإضافة لفحص
`is_super_admin` المباشر. **مفيش قايمة أسماء أدوار hardcoded في أي مكان** — دور جديد يتعمل بـrole
builder ويتاخد له صلاحية من المجموعة دي، المستخدم بيبقى ملزَم فورًا من غير أي تعديل كود.

### 2. جدولين تخزين جداد + عمودين إضافيين — بأسماء بعيدة تمامًا عن `user_devices`

**`webauthn_credentials`** (مفاتيح Passkey العامة — السيرفر أبدًا ميخزّنش بصمة/بيانات بيومترية
خام، WebAuthn بطبيعتها public-key، الـFace ID/Touch ID بيحصل محليًا على الجهاز بس):
```sql
CREATE TABLE webauthn_credentials (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id           UUID NOT NULL REFERENCES users(id),
  credential_id     TEXT NOT NULL UNIQUE,   -- base64url، معرّف الـcredential من المصادِق
  public_key        TEXT NOT NULL,          -- base64url لمفتاح COSE العام
  sign_count        BIGINT NOT NULL DEFAULT 0,   -- منع replay (raised كل استخدام، لازم يزيد)
  device_label      VARCHAR(120) NULL,      -- "iPhone بتاع أحمد" — المستخدم بيسمّيه وقت التسجيل
  transports        JSONB NULL,             -- ["internal","hybrid",...] من المتصفح وقت التسجيل
  backed_up         BOOLEAN NOT NULL DEFAULT false,  -- credential متزامن (iCloud Keychain/Google Password Manager)
  last_used_at      TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**`admin_mfa_recovery_codes`** (راجع §6 للتصميم الكامل):
```sql
CREATE TABLE admin_mfa_recovery_codes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id      UUID NOT NULL REFERENCES users(id),
  code_hash    VARCHAR(255) NOT NULL,   -- bcrypt، نفس نمط otp_codes.code_hash
  used_at      TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**`webauthn_challenges`** (تحديات مؤقتة لكل ceremony — جدول منفصل عن `otp_codes` عمدًا: التحدي
مش مرتبط برقم موبايل، وشكل الـpayload مختلف تمامًا — `challenge` خام لازم يترجع بالحرف لمكتبة
التحقق):
```sql
CREATE TABLE webauthn_challenges (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id         UUID NULL,   -- NULL لو discoverable-credential login (السيرفر لسه ميعرفش مين قبل ما يتحقق)
  ceremony_type   VARCHAR(20) NOT NULL CHECK (ceremony_type IN ('registration','authentication','step_up')),
  challenge       TEXT NOT NULL,
  is_used         BOOLEAN NOT NULL DEFAULT false,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**تعبية `refresh_tokens` الموجودة** (مش جدول جديد — الأعمدة موجودة أصلاً بس فاضية): `AuthService`
بقى ياخد `device_id`/`device_name`/`device_platform` اختياريين من `VerifyOtpDto`/`RefreshTokenDto`
(العميل بيولّد `device_id` مرة واحدة ويخزّنه محليًا، نفس فلسفة `notifications`'s `RegisterDeviceDto`
بالظبط بس لجدول مختلف تمامًا). عمودين جداد: `last_seen_at` (بيتحدّث في `refresh()`) و`user_agent`.

### 3. تدفق الدخول — Phone+OTP يفضل الخطوة الأولى دايمًا، Passkey بيتضاف فوقه لو الحساب High-Privilege

`AuthService.login()` بعد `consumeOtp()` الناجح (زي ما هو بالحرف)، قبل `issueTokenPair()`:

1. `MfaPolicyService.userRequiresMfa(user.id)` → `false` (الغالبية العظمى — عميل/فني/موظف عادي)
   → **مفيش أي تغيير سلوكي خالص**، `issueTokenPair()` زي ما هو بالضبط، JWT الجديد فيه
   `amr: ['otp']`.
2. `true` وعنده `webauthn_credentials` صف واحد على الأقل → السيرفر **مايصدرش** التوكنات
   النهائية. بيرجّع `{mfa_required: true, mfa_session_token, ceremony: 'authentication'}` —
   `mfa_session_token` توكن قصير العمر (5 دقايق، JWT موقّع منفصل بـsecret مختلف عن access/refresh
   secrets، `typ: 'mfa_pending'`) بيحمل `sub=user.id` بس. الـclient بينادي
   `POST /auth/webauthn/authentication/options` (بالتوكن ده) → challenge حقيقي → المستخدم يعمل
   Face ID/Touch ID محليًا → `POST /auth/webauthn/authentication/verify` (بالتوكن + الرد) →
   لو صح، **دلوقتي بس** بيتصدر access/refresh الحقيقيين بـ`amr: ['otp','webauthn']`.
3. `true` وصفر `webauthn_credentials` (أول مرة، أو المصادِق اتفقد) → نفس فكرة (2) بس
   `ceremony: 'registration'` — المستخدم لازم يسجّل Passkey جديد قبل ما يكمل، مفيش bypass.
   بعد التسجيل الناجح، نفس إصدار التوكنات النهائية بـ`amr: ['otp','webauthn']`.

**الدخول السريع اليومي (Passkey بس، بدون OTP)**: Passkey مسجّل بـ`residentKey: 'required'`
(discoverable credential) — المتصفح/الجهاز بيعرض قايمة الحسابات المتاحة من غير ما نطلب رقم
الموبايل الأول. `POST /auth/webauthn/authentication/options` (بدون `mfa_session_token`، endpoint
عام) بيرجّع تحدي عام (`user_id=NULL` في `webauthn_challenges`)، الرد بيحمل `userHandle` (=`user.id`)
اللي السيرفر بيستخرج منه هوية المستخدم. **السيرفر برضه بيتحقق حي إن الحساب `active`، الدور
والصلاحيات ما اتسحبتش، والـsession ما اتلغتش** — بالظبط زي ما المالك نص، مفيش فرق في القوة عن
مسار OTP+Passkey من ناحية فحص الحساب وقت كل request (`JwtStrategy.validate()` بيفضل بيشتغل زي ما
هو، مفيش استثناء لحسابات دخلت بـPasskey بس).

### 4. Step-up Re-authentication — توكن قصير العمر منفصل، مش claim جوّه access token

`StepUpGuard` جديد + `@RequireStepUp()` decorator، على نمط `PermissionsGuard`/`@RequirePermission`
بالحرف. العمليات المحمية (مسجّلة صراحة في طلب المالك): تغيير حساب/طريقة صرف، اعتماد/تحويل مبالغ
كبيرة، إنشاء Super Admin جديد، تغيير Roles/Permissions، تعطيل أي حماية، تغيير رقم هاتف الأدمن،
سحب/إلغاء كل الجلسات، اعتماد Refund.

`POST /auth/webauthn/step-up/options` → `POST /auth/webauthn/step-up/verify` (Passkey فعلي **تاني**،
مش إعادة استخدام جلسة الدخول) → لو نجح، بيرجّع `step_up_token` — **معرّف صف حقيقي في Postgres**
(جدول جديد `step_up_tokens`: `id`, `user_id`, `expires_at`, `used_at`)، مش JWT موقّع ومش Redis
key. الطلب الحساس لازم يرفق `X-Step-Up-Token: <id>` — `StepUpGuard` بيعمل `UPDATE step_up_tokens
SET used_at=now() WHERE id=$1 AND user_id=$2 AND used_at IS NULL AND expires_at > now() RETURNING
id` (استهلاك ذرّي مرة واحدة، نفس فلسفة `pessimistic_write`/atomic-consume المتّبعة في المشروع كله)
— صف واحد اترجع = نجاح واستهلاك فوري، صفر صفوف = رفض (منتهي/مستخدم قبل كده/مش بتاعه). **قرار
تصميم مهم اتاخد بعد مراجعة**: **مش Redis** — `RedisCacheService` الموجود مبني على فلسفة "أي فشل
Redis = cache miss آمن" (مناسب لتسريع قراءة بس، القاعدة تفضل مصدر الحقيقة)، لو استخدمناه لتتبّع
استهلاك `step_up_token`، انقطاع Redis كان هيخلي كل توكن "يبان مستخدم قبل كده = لأ" دايمًا، يعني
**فشل أمني fail-open** (كل حد يقدر يعيد استخدام نفس التوكن وقت انقطاع Redis) — عكس المطلوب تمامًا
لضابط أمان. Postgres بيضمن fail-closed حقيقي (لو الداتابيز واقعة، الطلب الحساس نفسه أصلاً مش
هيعدّي). **قرار تصميم متعمّد تاني**: توكن منفصل قصير جدًا (دقيقتين) بدل "متى آخر مرة عملت MFA"
claim جوّه access token — أبسط، وميضطرش access token (15 دقيقة بالفعل) يحمل معلومة زمنية إضافية،
وبيضمن كل عملية حساسة محتاجة تأكيد **حديث فعلاً** مش "كان عندي MFA من شوية".

### 5. إدارة الأجهزة والجلسات

`GET /auth/sessions` — كل صفوف `refresh_tokens` النشطة (`is_revoked=false`) للمستخدم الحالي،
`device_name`/`device_platform`/`ip_address`/`last_seen_at`/`created_at` (بدون `token_hash` —
مفيش داعي يترجع للـclient خالص). `DELETE /auth/sessions/:id` (يلغي جلسة واحدة بعينها —
`is_revoked=true, revoked_reason='user_revoked'`، لازم `id` يخص نفس المستخدم). `POST
/auth/sessions/revoke-all` (بيعيد استخدام `AuthService.revokeAllUserTokens()` الموجودة بالفعل،
مجرد export بدل private) — **العملية دي نفسها محتاجة `@RequireStepUp()`** (مسجّلة صراحة في طلب
المالك ضمن العمليات الحساسة).

**تغيير حساس في الحساب يُلغي الجلسات القديمة تلقائيًا** — `revokeAllUserTokens()` بتتنادى تلقائيًا
(مش يدوي من المستخدم) بعد: تسجيل Passkey جديد لأول مرة (enrollment)، استخدام recovery code
(§6)، أو أي تعديل مستقبلي على رقم الموبايل. الجلسة الحالية اللي عملت التغيير بتفضل شغالة (نفس
منطق `deleteMe()` الموجود بالفعل بيستثني الطلب الحالي — يتبع نفس النمط).

### 6. Recovery — رمز استرجاع + OTP مع بعض، مش SMS بمفرده

**المشكلة اللي المالك حددها بدقة**: "نسيت الحساب → SMS → رجعت Super Admin" بيلغي كل حماية
الـPasskey. **الحل**: Recovery محتاج **عاملين مستقلين مع بعض**، مش عامل واحد:
1. Recovery code (حاجة الأدمن **حفظها** وقت التفعيل — مش حاجة بتوصله دلوقتي زي SMS/Email).
2. Phone+OTP (حاجة الأدمن **يملكها** دلوقتي — نفس مسار الدخول العادي).

**التفعيل**: أول ما أدمن يسجّل أول Passkey ليه (enrollment، §3.3)، السيرفر بيولّد **10 أكواد
استرجاع** (`crypto.randomBytes` → صيغة مقروءة `XXXX-XXXX-XXXX`)، بيتعرضوا **مرة واحدة بس** في
الرد (زي أي recovery-codes flow قياسي — GitHub/Google نفس النمط بالظبط)، مُخزّنين hashed
(`bcrypt`، نفس `otp_codes.code_hash`) في `admin_mfa_recovery_codes`. **مفيش إعادة عرض بعد كده
أبدًا** — لو الأدمن مالحقش يسجّلهم، الحل الوحيد إعادة توليد سِت جديد (بيلغي القديم بالكامل).

**الاستخدام**: `POST /auth/recovery/verify` — بياخد `phone_number` + `otp_code` (زي login عادي)
**+ `recovery_code`** مع بعض في نفس الطلب. لو الاتنين صحّ (OTP يتستهلك زي العادي، recovery code
يتقارن `bcrypt.compare` ضد الصفوف الغير مستخدمة لنفس المستخدم) → دخول ناجح، **الكود ده يتعلّم
`used_at` فورًا (مايتكررش استخدامه)**، **كل الجلسات القديمة تتلغي تلقائيًا** (`revokeAllUserTokens`)،
وإشعار فوري لـ`super_admin`/دور أمان عبر `NotificationRoutingService.routeToRole('admin_mfa.recovery_used', ...)`
(نفس نمط `assistant_matching.escalated` — تصعيد أمني حقيقي، مش اختياري). المستخدم **ملزَم**
يسجّل Passkey جديد فورًا (نفس تدفق §3.3) قبل ما يقدر يعمل أي حاجة تانية — الرد بيحمل
`must_reenroll: true` صريح.

**لو كل الـ10 أكواد اتستهلكوا أو المستخدم فقدهم من غير استخدام**: مفيش مسار "استرجاع الاسترجاع"
تلقائي — ده بالتصميم (وإلا رجعنا لنفس مشكلة "عامل ضعيف واحد كافي"). التعافي في الحالة دي محتاج
تدخّل يدوي من `super_admin` تاني عنده Passkey شغال (`POST /admin/users/:id/mfa/reset` جديد،
`@RequireStepUp()` + `roles.manage` — بيمسح كل `webauthn_credentials`/`admin_mfa_recovery_codes`
بتاعة المستخدم المتأثر، يجبره يعمل enrollment كامل تاني من الصفر المرة الجاية اللي يسجّل دخول
فيها بـOTP). **نطاق Phase 1**: الـendpoint ده هيتبني، بس واجهة الأدمن ليه مؤجّلة (زي أي CRUD جديد
قبل واجهته — نفس نمط محرك التسعير Phase 1/2).

## البدائل اللي اتقيّمت

- **`amr`/`mfa_verified_at` claim جوّه access token طويل المدى لـstep-up**: رُفض — access token
  عمره 15 دقيقة أصلاً (كافي)، بس المشكلة إن "عملت MFA قبل 14 دقيقة" لسه بيعتبر "حديث" حسب
  التعريف ده رغم إن العملية الحساسة ممكن تحصل في أي لحظة عشوائية من الـ15 دقيقة دي. توكن step-up
  منفصل قصير جدًا (دقيقتين) بيضمن "حديث فعلاً وقت العملية" مش "حديث نسبيًا لبداية الجلسة".
- **إعادة استخدام `user_devices` (موديول notifications) لـWebAuthn credentials أو trusted
  devices**: رُفض بشدة — دورة حياة مختلفة تمامًا (push token بيتغير كل تثبيت، WebAuthn credential
  تشفيري ثابت)، خلط المفهومين هيكسر منطق FCM الموجود ومختبر بالفعل.
  `refresh_tokens.device_id/device_name/device_platform` (موجودين، فاضيين) هما الأنسب لتتبّع
  "جلسة/جهاز" — الـWebAuthn credential نفسه (المفتاح العام) له جدول منفصل تمامًا (`webauthn_credentials`)
  لأنه كيان مختلف جوهريًا (سر تشفيري، مش مجرد معرّف جلسة).
- **Redis لتخزين الـWebAuthn challenges و/أو `step_up_token` (بدل جداول Postgres)**: اتقيّم
  ورُفض للاتنين. التحديات لازم تتربط بـ`ceremony_type`/`user_id` بشكل استعلامي واضح لأغراض تدقيق
  أمني (مين حاول يعمل enrollment وامتى)، نفس فلسفة `otp_codes`. `step_up_token` تحديدًا **لازم
  Postgres مش Redis** — `RedisCacheService` الموجود مبني على "فشل Redis = miss آمن" (صح لتسريع
  قراءة، غلط تمامًا لضابط أمان استهلاك-مرة-واحدة): لو استخدمناه، انقطاع Redis كان هيخلي كل توكن
  "يبان جديد" دايمًا = ثغرة إعادة استخدام حقيقية وقت أي انقطاع. Postgres = fail-closed صحيح.
- **حظر SMS تمامًا كعامل استرجاع**: رُفض — SMS/OTP لسه مطلوب كعامل تحقق ملكية الرقم في الاسترجاع،
  بس **مش العامل الوحيد** (recovery code مطلوب معاه إجباريًا). حظر SMS بالكامل كان هيبني UX
  استرجاع أعقد بلا داعي أمني حقيقي إضافي — المشكلة الأصلية كانت "SMS بمفرده"، مش "SMS خالص".
- **تخزين recovery codes بدون hashing (نص عادي، للراحة الإدارية)**: رُفض قطعيًا — نفس مبدأ
  `otp_codes.code_hash`/`password_hash` الموجود، بيانات استرجاع حساسة تتخزن hashed دايمًا.

## الأثر

- Migration جديدة (`0088_admin_mfa_webauthn.sql`): 4 جداول (`webauthn_credentials`,
  `admin_mfa_recovery_codes`, `webauthn_challenges`, `step_up_tokens`) + عمودين على
  `refresh_tokens` (`last_seen_at`, `user_agent`، الأعمدة التانية موجودة أصلاً وفاضية).
- Dependency جديدة: `@simplewebauthn/server` (باك-إند)، `@simplewebauthn/browser` (`apps/admin`،
  Phase 2 UI).
- موديول `auth` يتوسّع (مش موديول موازٍ جديد): `MfaPolicyService`, `WebAuthnService`,
  `StepUpGuard`+`@RequireStepUp()`, controllers جداد (`/auth/webauthn/*`, `/auth/sessions/*`,
  `/auth/recovery/verify`, `/admin/users/:id/mfa/reset`).
- `AuthService.login()`/`refresh()`/`issueTokenPair()` بيتغيّروا (فرع MFA قبل إصدار التوكن
  النهائي، `amr` claim جديد، `device_id`/`device_name`/`device_platform` اختياريين من DTOs).
  **صفر تغيير سلوكي لأي حساب مش High-Privilege** — نفس المسار بالحرف زي النهاردة.
- **نطاق Phase 1 (هذا الـADR) — Backend كامل بس**: واجهة `apps/admin` (تسجيل Passkey، شاشة
  الأجهزة/الجلسات، step-up prompt وقت العمليات الحساسة، شاشة عرض recovery codes مرة واحدة) —
  **مؤجّلة صراحة لـPhase 2**، نفس نمط محرك التسعير (Backend أولاً يثبت، بعدين UI). الـAPI جاهزة
  بالكامل وقابلة للاستخدام عبر `curl`/Postman لحد ما الواجهة تتبني.
- **نطاق مؤجّل صراحة أبعد من كده**: Face ID/بصمة للعميل/الفني (`local_auth` Flutter، غير ذي صلة
  بـWebAuthn — تقنية مختلفة تمامًا، مسجّلة في `docs/08` §14 بس خارج نطاق الـADR ده).
