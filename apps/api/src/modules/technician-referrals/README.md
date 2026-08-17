# modules/technician-referrals

ترشيح QR الفني + مكافأة الترشيح (docs/11 §1 — طلب صريح من المالك، 2026-08-13). جداول:
`technician_referral_attributions`, `technician_referral_bonuses` (`infra/migrations/0082`).

**الحالة: شغال بالكامل، مختبر حي (E2E حقيقي، مش mocks).**

## الفكرة

كل فني عنده رمز ترشيح دائم — بنعيد استخدام `technician_profiles.technician_code` الموجود
أصلاً (`TECH-000123`) بدل ما نخترع عمود جديد. الفني بيشارك الرمز ده (QR أو نص) مع عملاء
جدد/حاليين. لو عميل استخدم الرمز وعمل طلب "مؤهّل" (حسب إعدادات قابلة للتغيير)، الفني ياخد
مكافأة مالية عبر نظام المحفظة الموجود.

**كل قاعدة عمل هنا قابلة للتعديل من `settings` (`group_name='referral_qr'`) — الكود
مبنيّ عمداً من غير أي رقم/شرط مكتوب صريح في الكود (المبدأ الحاكم من المالك):**

| المفتاح | الافتراضي | المعنى |
|---|---|---|
| `enabled` | `true` | تفعيل/تعطيل النظام كله |
| `bonus_amount_cents` | `5000` | قيمة المكافأة بالقرش |
| `qualifying_min_order_status` | `"completed"` | أقل حالة طلب تخلّي المكافأة تستحق |
| `reward_mode` | `"first_order_only"` | أو `"every_qualifying_order"` |
| `min_order_amount_cents` | `0` | حد أدنى لقيمة الطلب (0 = بدون حد) |
| `max_monthly_bonus_cents_per_technician` | `0` | سقف شهري للفني (0 = بلا سقف) |
| `min_minutes_between_bonuses` | `0` | فترة تهدئة بين مكافأتين لنفس الفني (0 = معطّل) |
| `reject_duplicate_device` | `true` | رفض المكافأة لو نفس جهاز العميل استُخدم قبل كده لعميل تاني اتكافأ عليه نفس الفني |

## تدفّق الإسناد (attribution)

- **عميل جديد**: `technician_referral_code` اختياري في `POST /auth/register` — لو موجود،
  **مبيوقفش التسجيل لو غلط** (على عكس `referral_code` العادي اللي بيرفض) لأنه مش شرط أساسي
  للتسجيل. بيتصدّر `TECHNICIAN_REFERRAL_CAPTURED_EVENT` بعد إنشاء المستخدم، و`technician-referrals`
  بيسمعه في listener منفصل (`AuthModule` فاضل مش عارف حاجة عن الموديول ده — فصل تام).
- **عميل حالي**: `POST /me/technician-referral` (`@Roles(CUSTOMER)`) — بيرفض لو العميل عنده
  إسناد قبل كده أو لو ده رمز نفسه (self-referral، دفاعية — مستحيل حاليًا لأن `phone_number`
  فريد فمينفعش نفس الشخص يبقى فني وعميل بنفس اليوزر، بس الكود بيتحقق منها زيادة احتياط).
- **قاعدة "أول إسناد بيربح، دائم"** — نفس منطق نظام الترشيح بين العملاء الموجود أصلاً
  (`users.referred_by_user_id`)، عبر `UNIQUE(customer_user_id)` في `technician_referral_attributions`.

## تقييم المكافأة (`evaluateOrderForBonus`)

بيتنفّذ من `technician-referral-order-status.listener.ts` على `ORDER_STATUS_CHANGED_EVENT`
(نفس الحدث الموجود أصلاً، مفيش حدث جديد). بالترتيب:

1. `enabled` setting + رتبة الحالة الجديدة ≥ رتبة `qualifying_min_order_status`
   (`accepted=1 < work_completed=2 < completed=3`).
2. يقفل الطلب ويعيد فحص حالته الحالية، ثم يقفل attribution والفني بترتيب ثابت.
3. Idempotency: صف موجود بالفعل لنفس `order_id` (UNIQUE) → توقف فورًا.
4. `reward_mode='first_order_only'` → فيه مكافأة `credited` سابقة لنفس زوج (فني، عميل)؟
5. `min_order_amount_cents`.
6. فحوصات مكافحة الاحتيال بالترتيب (أي رفض بيسجّل صف `rejected_suspicious` ومبيلمسش المحفظة):
   جهاز مكرر → تهدئة زمنية → سقف شهري.
7. لو عدّى كل ده: صف bonus و`WalletsService.doubleEntry()` (محفظة المنصة → محفظة الفني،
   `WalletTxType.REFERRAL_REWARD`) يتحفظوا في transaction واحدة، ثم audit وإشعار best-effort.

**الإلغاء** (`revokeBonusForOrder`, على `cancelled`/`refunded`): بيلاقي صف `credited` لنفس
الطلب ويقفله، `WalletsService.reverseDoubleEntry()` تقفل القيدين الأصليين وتعيد نفس العكس لو سبق،
ويقلب الحالة لـ`revoked` في نفس transaction، ثم audit + إشعار.

## تقوية النزاهة المالية والتزامن (Script 1 Phase 4، migrations 0116 و0120)

قبل 0116 كان wallet credit يـcommit أولًا ثم صف bonus في عملية ثانية؛ crash بينهما يترك مالًا بلا
مصدر، وretry يقدر يضيفه ثانية. كذلك `first_order_only` والحد الشهري كانا read-then-write، والـrevoke
كان بلا قفل. الآن قفل الفني يسلسل quota/cooldown، وقفل attribution يسلسل سياسة أول طلب، والbonus
والledger أثر واحد ذري. `TechnicianReferralRecoveryService` يفحص PostgreSQL كل دقيقة ويستعيد حدث
منح أو إلغاء ضاع بعد commit. كما يتعرف على crash القديم الذي ترك قيدي محفظة بمرجع `order_id` قبل
حفظ صف bonus: يعيد بناء المصدر من نفس القيدين بلا credit جديد، ثم يعكسهما إذا كان الطلب أصبح نهائيًا.
القيد القديم غير القابل للمطابقة ينتقل مرة واحدة إلى `manual_review` (migration 0120) ويظهر في فلتر
ولوحة الأدمن بدل إسقاط sweep إلى الأبد. الـworker يمسح الـinterval في `onModuleDestroy`.

`technician-referral-financial-integrity.spec.ts` أثبت 9 حالات على PostgreSQL حقيقي: rollback كامل عند
failure injection، فائز واحد لطلبين first-order، عدم تجاوز cap بطلبين متزامنين، عكس واحد فقط لنداءي
revoke، missed-event recovery، reward×terminal/revoke، استرجاع legacy بلا تكرار، استرجاعه وعكسه بعد
refund، وإنهاء القيد الناقص في `manual_review`.

## بَقّة حقيقية اتلقطت واتصلحت وقت الاختبار الحي — فحص الجهاز المكرر كان بلا أي أثر فعلي

**الفحص الأول** كان بيقارن صفوف `user_devices` اللايف للفني والعميل مباشرة. لكن
`user_devices.device_id` **فريد على مستوى الجدول كله** (ملكية الجهاز بتتنقل بين المستخدمين —
`NotificationsService.registerDevice()` موثّق فيه صراحة "لو device_id مسجّل قبل كده لمستخدم
تاني... بننقل ملكيته"، مش سجل تاريخي متراكم). يعني مستحيل رياضيًا يبان نفس `device_id` كمُلك
لمستخدمين مختلفين في نفس اللحظة — الفحص كان **no-op دايمًا** بلا استثناء.

**اتلقطت باختبار حي فعلي**: سجّلنا نفس `device_id` أولًا لفني، وبعدين لعميل جديد، وراقبنا
الفحص "المكرر" بيفشل يتفعّل. **الإصلاح**: عمود جديد `technician_referral_bonuses.customer_device_id`
بياخد **صورة (snapshot)** من `device_id` بتاع العميل وقت التقييم، والمقارنة بقت ضد الصور
المخزّنة على صفوف مكافآت سابقة لنفس الفني (مش ضد `user_devices` اللايف) — كده الفحص بيفضل
صحيح حتى لو ملكية الجهاز اتنقلت بعد كده.

**اتأكد حي بسيناريو 3 عملاء/جهاز واحد**: عميل 1 → مكافأة `credited` عادي (أول استخدام، الصورة
اتخزنت). عميل 2 اتسجّل بنفس الـ`device_id` (اتنقلت ملكيته)، طلب حقيقي اكتمل → اترفض
`rejected_suspicious` بالسبب "نفس الجهاز استُخدم قبل كده لعميل مختلف اتكافأ عليه الفني ده —
احتمال حسابات وهمية"، وتأكدنا صفر معاملات محفظة اتعملت للمكافأة المرفوضة.

## الأدمن (`GET /admin/technician-referrals`, `GET /admin/technician-referrals/technicians/:id`)

قراءة فقط (مفيش أي إجراء يدوي من الأدمن على المكافآت — القرار كله آلي حسب الإعدادات، مطابق
لما طلبه المالك: "Backend هو مصدر الحقيقة"). فلاتر: `status`, `technician_id`, صفحات.
لوحة `/technician-referrals` في `apps/admin` بتعرض جدول + إجمالي لكل حالة
(مستحقة/ملغاة/مرفوضة/مراجعة يدوية)، وفلترًا مباشرًا للحالات الأربع.

## الفني (`GET /technician/referrals`)

`getTechnicianSummary()`: `referralToken` (= `technician_code`)، عدد العملاء المُسنَدين،
عدد الطلبات المؤهّلة، إجمالي مستحق/ملغى/مرفوض، وآخر 20 مكافأة. شاشة `ReferralScreen` في
`apps/technician-app` بتعرض QR (عبر `qr_flutter`) + مشاركة (`share_plus`) + الإحصائيات دي.

## فجوات موثّقة

مفيش. كل ما طُلب مبني: backend + migration + admin UI + technician-app UI + customer-app UI
(تسجيل جديد + شاشة "عندي كود ترشيح" للعميل الحالي) + إشعارات + audit log + محفظة (double-entry
وidempotent عبر `order_id` UNIQUE والأقفال/transaction) + صلاحيات (قراءة أدمن مفتوحة، مفيش endpoints تعديل تحتاج
صلاحية لأنه مفيش تعديل يدوي أصلاً) + اختبار حي شامل (الترتيب أعلاه) بما فيه اختبار سلبي
(جهاز مكرر مرفوض فعليًا بصفر أثر على المحفظة).
