# packages/shared-types

أنواع TypeScript مشتركة بين `apps/api` و `apps/admin` و `apps/customer-web` — مبنية مباشرة على `docs/02-data-dictionary.md`. أي تغيير في الأنواع دي لازم يتحدث فيه القاموس الأول.

## مهم: الحزمة دي فيها **قيم وقت-التشغيل** مش أنواع بس

غير الأنواع (اللي بتتمسح وقت الترجمة)، الملف ده بيصدّر ثوابت حقيقية بتتنفذ في المتصفح:
`PRICING_METHODS` و`PRICING_MODEL_LABELS` و`FORMULA_LIMITS` (في `src/pricing.ts`)،
`BRANDING_ASSET_LABELS_AR` و`BRANDING_ASSET_TYPES`، و`isMfaRequiredResponse`.

`main` بيشاور على `dist/` و`dist/` مستبعدة من Git (`.gitignore`). يعني بعد أي `git pull`
بيضيف export جديد للقيم دي، الـ`dist` المحلية بتبقى **قديمة**، والمستورد بيلاقي `undefined`
وقت التشغيل مع إن `tsc` عدّى — لأن Next dev مابيعملش typecheck.

### البَقّة الحقيقية اللي حصلت (2026-09-01)

بعد `git pull` لشريحة §88-د، صفحة `/catalog` في لوحة الأدمن وقعت بـ
`TypeError: Cannot read properties of undefined (reading 'fixed')` عند
`PRICING_MODEL_LABELS[service.pricing_model]`. السبب مكانش في الكود: `dist/pricing.js`
المحلية كانت متبنية قبل ما الـexport ده يتضاف، فـ`PRICING_MODEL_LABELS` نفسها كانت `undefined`.
الدليل إن `FORMULA_LIMITS` (export أقدم) كان شغال عادي في نفس اللحظة من نفس الحزمة.

### الإصلاح البنيوي (مش يدوي تاني)

- `apps/admin` و`apps/customer-web` عندهم `predev` و`prebuild` و`pretypecheck` بينفذوا
  `npm --prefix ../../packages/shared-types run build` — فمستحيل يشتغل dev server أو build
  على `dist` قديمة.
- `prepare` هنا بيبني الحزمة تلقائيًا مع أي `npm install` من جذر الـmonorepo.
- لو بتعدّل في `src/` والـdev server شغال بالفعل: شغّل `npm run build:watch` في تيرمينال تاني
  (كان مفيش watch mode قبل كده — دي كانت الفجوة اللي خلّت البَقّة ممكنة أصلاً).

مرجع كامل: `../../docs/01-master-plan.md`
