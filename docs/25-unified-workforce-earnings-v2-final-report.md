# Unified Workforce Earnings Engine V2 - Final Audit Report

تاريخ التدقيق: 2026-08-31. المرجع المعماري: [ADR-0058](./adr/0058-unified-workforce-earnings-engine-v2.md).

## A. Audit

المصادر القديمة التي وُجدت كانت: نسبة عمولة الخدمة، فرق العمولة حسب مستوى الفني، فرق العمولة حسب
نوع الحجز، إعدادات وعاء العمولة، توزيع الطاقم بالأوزان، نسبة مساعد عامة، ومسار مستقل لأجر المساعد
الثابت ومعامل مستواه. كما وُجدت قراءات منفصلة في التسوية والمحفظة وكشف الفني وKPI والاسترداد.

## B. Conflicts

التعارض الرئيسي كان وجود طريقتين لتوزيع نفس أموال الطاقم: `weighted_pool` و
`assistant_level_wage`. كما كانت عمولة المنصة قابلة للتغيير من الخدمة والمستوى ونوع الحجز، بينما
تعرض بعض الشاشات إجمالي الطلب وبعضها نصيب الفني. الاسترداد كان معرضًا لإعادة الحساب بسياسة حالية
بدل عكس اللقطة الأصلية.

## C. New Architecture

```text
Service fixed commission
        |
        v (snapshot at order creation)
Order V2 final total ----> Platform bucket (fixed once)
        |
        +----> Worker pool = final total - fixed commission
                         |
                         v
             Canonical integer-weight calculator
                         |
          +--------------+---------------+
          v                              v
 immutable participant shares      wallet transactions
          |
          +----> statements / KPI / reports / refund reversals
```

المصدر الوحيد للحساب هو `earnings-calculator.ts`. محلل السياسة الوحيد هو
`earnings-policy.service.ts`. المبالغ بالقروش، العوامل basis points صحيحة، والتقريب largest
remainder بترتيب ثابت. الفني والمساعد مشاركان في وعاء واحد؛ الدور في الطلب منفصل عن نوع الشخص.

## D. Migrations

- `0227_unified_workforce_earnings_v2.sql`: عمولة خدمة ثابتة، لقطة V2 على الطلب، أوزان المستوى
  ونسب المساعد، مهارة الخدمة، overrides، adjustments، snapshots للحصص، عكس الاسترداد وshadow mode.
- `0228_unified_earnings_v2_integrity.sql`: قيود اتزان واكتمال snapshots وصلاحيات super admin.
- الطلبات القديمة تبقى V1. التفعيل صريح ويؤثر فقط على الطلبات الجديدة.

## E. Legacy Removal

إدخال نسبة العمولة أزيل من إدارة الكتالوج، وإعدادات V1 المالية تصبح انتقالية ومقفلة بعد cutover.
حقول V1 باقية للقراءة التاريخية فقط حتى يمكن تفسير وتسوية الطلبات القديمة. `PaymentsService`
يفصل V1/V2 صراحة؛ لا يوجد fallback صامت من V2 إلى V1.

## F. Platform Commission Proof

اختبار `allows bounded adjustments without changing platform commission` يغيّر المستوى والدور
والمهارة والتعديلات ويثبت ثبات platform commission والworker pool. السيناريو النهائي يثبت أن
طلب 5000 جنيه يعطي المنصة 500 جنيه بالضبط، بلا نسبة أو تعديل booking mode أو خصم مستوى.

## G. Earnings Proof

الهوية المفروضة في الكود والقيود هي:

```text
platform_commission_cents + sum(participant_share_cents) = total_amount_cents
```

تغطي الاختبارات فنيًا منفردًا، فنيًا يعمل كمساعد، مساعدًا دائمًا، فريقًا متعددًا، صفر worker pool،
قروش التقريب، duplicate participants، assistant leader المرفوض، و250 تركيبة deterministic.

سيناريو القبول: الإجمالي 500000 قرش، المنصة 50000، الوعاء 450000، أحمد 292398، عمر 157602.
ترقية عمر تغير الطلب التالي فقط ولا تغير snapshot الطلب القديم.

## H. Progression Proof

اختبار `technician-progression-calculation.service.spec.ts` يمرر مساعدًا دائمًا في نفس السلم:
new -> verified -> professional -> premium -> team_leader، باستخدام نفس شروط ومحرك الترقيات.
الواجهة تعرض المستويات تصاعديًا من نجمة إلى خمس نجوم.

## I. Refund Proof

`settlement-refund-allocation.spec.ts` يثبت الاسترداد الكامل والجزئي والمتكرر والتقريب. دفعات
10% + 20% + 30% + 40% تساوي استرداد 100% مرة واحدة. في سيناريو القبول، أول 40% تعكس 20000
من المنصة و116959 من أحمد و63041 من عمر، ثم تكمل الدفعة التالية كل bucket إلى أصله بالضبط.

## J. UI

- Admin > Earnings Policy Center: readiness، cutover، shadow، الأوزان، نسب المساعد، المهارات،
  عمولات الخدمات الثابتة، overrides، adjustments، simulator، audit history.
- تفاصيل الطلب: breakdown كامل للأدمن فقط.
- تطبيق الفني: كشف خاص بحصته والكاش والاسترداد والصافي فقط.
- صفحات الإعدادات والمستويات والكتالوج أزيل منها تضارب التحكم المالي.

## K. API and Shared Types

أضيفت عقود policy/readiness/simulation/shadow/audit وحقول policy version وfixed commission snapshot
وworker pool وparticipant snapshots. عقد تطبيق الفني العام منقح لمنع كشف إجمالي العميل أو خصمه أو
عمولة المنصة، بينما عقد الأدمن الداخلي يحتفظ بالتفاصيل للمطابقة.

## L. Tests

- Backend regression: 237 suites و1357 tests ناجحة.
- Acceptance + progression focused run: مجموعتان و15 test ناجحة.
- Admin: typecheck وlint وproduction build ناجحة.
- Shared types وNest build ناجحان.
- Customer Flutter: analyze بلا errors/warnings، 83/83 tests، وdebug APK ناجح.
- Technician Flutter: analyze بلا errors/warnings، 32/32 tests، وdebug APK ناجح.
- migrations 0227/0228 طُبقت على قاعدة التطوير المرفوعة مع نظام checksums.

## M. Remaining Risks

- لم يُنفذ clean-database migration rehearsal مستقل في هذه الجولة؛ قاعدة التطوير المرفوعة وbackend
  regression هما التحقق المتاح، ويجب تنفيذ clean restore في CI/staging قبل production cutover.
- API lint غير قابل للتشغيل حاليًا لأن المستودع يستخدم ESLint 9 بلا `eslint.config.*`؛ البناء
  والاختبارات لا تتأثر، لكن إعداد lint يحتاج مهمة مستقلة.
- بناء macOS يحتاج Xcode الكامل؛ الجهاز الحالي عليه Command Line Tools فقط. إعدادات sandbox والشبكة
  والموقع ومسار التشغيل أضيفت، لكن لا يُدعى أن macOS binary بُني على هذا الجهاز.
- `safe_device` يصدر تحذير توافق مستقبلي مع Built-in Kotlin، رغم نجاح Android debug build الآن.

خطوات التفعيل والإيقاف والمراقبة موثقة في
[runbook](./runbooks/earnings-v2-cutover.md). لا يُفعّل V2 قبل readiness 100% ونسخة احتياطية وتجربة
cash/online/deposit/team/partial refund/full refund على staging.
