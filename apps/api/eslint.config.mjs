// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * لينت الباك-إند — أول إعداد lint للموديول ده على الإطلاق (docs/08 §132).
 *
 * `apps/admin` و`apps/customer-web` عندهم lint من زمان، لكن `apps/api` — أكبر جزء في المشروع
 * (~15 ألف سطر، 20 موديول) — كان بلا أي lint خالص: `npx eslint src` كانت بترد
 * «ESLint couldn't find an eslint.config.js». يعني `tsc` بيمسك أخطاء الأنواع بس، وأي كود ميت
 * أو `await` ناقص أو `catch` فاضي كان بيعدّي.
 *
 * القواعد مختارة على أساس **البقّات اللي فعلاً حصلت في المشروع ده**، مش على أساس «التوصية
 * الكاملة»: القاعدة الحاكمة إن أي فشل infra يتلقّط ويرجع بأمان، وده بيتكسر بالظبط بـPromise
 * مش متعمله await أو catch بيبلع الخطأ.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.config.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { process: 'readonly', Buffer: 'readonly', console: 'readonly', __dirname: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', NodeJS: 'readonly', Express: 'readonly' },
    },
    rules: {
      // **دي القاعدة اللي المشروع محتاجها فعلاً**: `queue.add()` بلا await كانت بتعلّق طلب
      // حقيقي دقايق وقت انقطاع Redis (الدرس المكلّف الموثّق في CLAUDE.md). Promise مهملة
      // في NestJS معناها خطأ بيضيع في الفراغ.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // `any` منتشر في الكود الحالي (الـmocks في السبيكس بالذات) — تحذير مش خطأ، عشان
      // اللينت يبقى قابل للتشغيل من أول يوم بدل ما يتعطّل.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: false }],
      // الكود فيه `eslint-disable` للقاعدتين دول في أماكن متفرقة — يعني حد نوى يشغّل لينت
      // على الموديول ده قبل كده. تفعيلهم بيخلّي التعليقات دي ذات معنى بدل ما تبقى ميتة.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // السبيكس بتستخدم `as never` و`{}` كـmocks عمدًا — القواعد التقيلة عليهم بتوجع بلا فايدة.
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      // `await cache.onModuleDestroy()` في teardown بيعدّي على دالة `void` — مقصود كتحصين
      // لو الدالة بقت async بعدين، ومالوش أي ضرر. القاعدة قيمتها الحقيقية في كود الإنتاج
      // (هناك `await` على حاجة مش Promise معناها عادةً إن حد فاكر إنه بيسلسل وهو مش بيسلسل)،
      // وهناك عددها **صفر** فعلاً. فحصرها هنا مش تهرّب — ده توجيهها لمكانها الصح.
      '@typescript-eslint/await-thenable': 'off',
    },
  },
);
