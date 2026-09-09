#!/usr/bin/env node
/**
 * **ج-١٥ — اختبار النسخة المبنية فعليًا**: «release build + prod API + HTTPS + push + deep links».
 *
 * الفرق بين `debug` و`release` مش تفصيلة بناء — هو فرق في **الكود اللي بيتنفّذ فعلاً**:
 *   - **R8/tree-shaking** بيشيل كلاسات مالهاش مرجع ثابت. أي حاجة بتتنادى بالـreflection
 *     (Firebase، فك JSON) ممكن تختفي — والانهيار بيحصل في `release` **بس**.
 *   - **فروع `kDebugMode` بتتشال بالكامل** — يعني قيمة افتراضية للتطوير ممكن تكون مغطّية عطلًا
 *     مايظهرش غير في يد المستخدم.
 *   - **`assert()` بتتشال** — فأي ثابت كان محمي بـassert بيعدّي بصمت.
 *
 * والأهم في القايمة: **deep links**. الباك-إند بيبعت `deep_link` مع الإشعار، والتطبيق بيوجّه
 * بيه. أي نمط الباك-إند بيبعته والتطبيق مش عارف يقراه = **العميل بيضغط الإشعار وماينفتحش
 * حاجة** — عطل صامت بالكامل: مفيش خطأ، مفيش لوج، مجرد إشعار مالوش لازمة.
 *
 * التدقيق ده **ثابت** (بيقرا الكود) مش حي — بناء APK حقيقي محتاج Android SDK مش متاح هنا،
 * وده مذكور صراحةً في النتيجة بدل ما يتغطّى.
 *
 *   node scripts/release-readiness-audit.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`);
}

function read(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

/** كل قيم `deepLink:` اللي الباك-إند بيبعتها فعلاً، متحوّلة لأنماط قابلة للمقارنة. */
function backendDeepLinks() {
  // `--include=*.ts` مع استبعاد ملفات الاختبار: قيم زي `/orders/abc` جوّه spec مش أنماط
  // حقيقية بيتبعتها للمستخدمين، وحسابها بيطلّع بلاغات كاذبة.
  const out = execFileSync(
    'bash',
    [
      '-c',
      // **بلا `-h`** عمدًا: لازم اسم الملف يبان عشان `grep -v spec` يقدر يفلتر عليه. مع `-h`
      // الأسماء بتتشال فالفلتر مابيلاقيش حاجة يطابقها — وده اللي خلّى `/orders/order-id`
      // (قيمة من spec) تتحسب كنمط إنتاجي في أول تشغيلة.
      `grep -rn --include='*.ts' 'deepLink:' '${path.join(ROOT, 'apps/api/src')}' | grep -v '\.spec\.ts'`,
    ],
    { encoding: 'utf8' },
  );
  const links = new Set();
  for (const line of out.split('\n')) {
    // بنمسك القوالب النصية (`/orders/${x}`) والنصوص الثابتة ('/warranties').
    const tpl = /deepLink:\s*[`'"]([^`'"]+)[`'"]/.exec(line);
    if (!tpl) continue;
    // تحويل `${...}` لعنصر مسار عام عشان المقارنة تبقى على **الشكل** مش القيمة.
    links.add(tpl[1].replace(/\$\{[^}]*\}/g, ':id'));
  }
  return [...links].filter((l) => l.startsWith('/'));
}

/** الأنماط اللي راوتر التطبيق بيعرف يتعامل معاها — مستخرجة من الكود نفسه. */
function routerPatterns(app) {
  const src = read(`apps/${app}/lib/core/deep_link_router.dart`);
  if (!src) return null;
  const patterns = [];
  for (const m of src.matchAll(/RegExp\(r'(\^[^']+)'\)/g)) patterns.push({ kind: 'regex', value: m[1] });
  for (const m of src.matchAll(/deepLink == '([^']+)'/g)) patterns.push({ kind: 'exact', value: m[1] });
  // `startsWith` نمط شرعي في الراوترين (`/technician/assistant-offers`, `/support-chat/`) —
  // إغفاله كان بيطلّع بلاغًا كاذبًا على مسار متعامَل معاه فعلاً (اتلقط في أول تشغيلة).
  for (const m of src.matchAll(/deepLink\.startsWith\('([^']+)'\)/g)) patterns.push({ kind: 'prefix', value: m[1] });
  for (const m of src.matchAll(/const\s+\w+\s*=\s*'(\/[^']+)';/g)) {
    if (/startsWith\(/.test(src)) patterns.push({ kind: 'prefix', value: m[1] });
  }
  return patterns;
}

function routerHandles(patterns, link) {
  for (const p of patterns) {
    if (p.kind === 'exact' && p.value === link) return true;
    if (p.kind === 'prefix' && link.startsWith(p.value)) return true;
    if (p.kind === 'regex') {
      // النمط في الكود بيتطابق على معرّف hex؛ بنجرّبه على المسار وقد استُبدل `:id` بمعرّف نموذجي.
      const probe = link.replace(/:id/g, '00000000-0000-4000-8000-000000000000');
      if (new RegExp(p.value).test(probe)) return true;
    }
  }
  return false;
}

function main() {
  console.log(`\n=== ج-١٥: جاهزية النسخة المبنية (release) ===\n`);

  // ---- ك-١: عنوان الـAPI مش هيتشحن بقيمة تطوير ----
  //
  // القيمة الافتراضية (`10.0.2.2`) عنوان محاكي Android — مستحيل يوصل لحاجة من جهاز حقيقي،
  // والعميل كان هيشوف «فشل الاتصال» بلا أي تفسير.
  for (const app of ['customer-app', 'technician-app']) {
    const src = read(`apps/${app}/lib/core/api_config.dart`);
    const hasGuard = !!src && /kReleaseMode/.test(src) && /throw StateError/.test(src);
    record(
      `ك-١ ${app}: إصدار release بيرفض الإقلاع لو اتبنى بعنوان تطوير`,
      hasGuard,
      hasGuard ? 'حارس fail-fast موجود (assertProductionApiConfig)' : 'مفيش حارس ❗',
    );
    // والحارس لازم يكون **متنادى فعلاً** — حارس معرَّف ومش مستخدَم بيساوي صفر.
    const main = read(`apps/${app}/lib/main.dart`);
    const called = !!main && /assertProductionApiConfig\(/.test(main);
    record(
      `ك-١/ب ${app}: والحارس متنادى من main() فعلاً`,
      called,
      called ? 'متنادى قبل runApp' : 'معرَّف بس مش متنادى ❗',
    );
  }

  // ---- ك-٢: HTTPS — مفيش عنوان http ثابت في الكود ----
  //
  // أي `http://` (مش https) مكتوب في الكود بيتشحن مع الإصدار. على Android 9+ الاتصال غير
  // المشفّر مرفوض افتراضيًا، فده بيبقى عطل صامت — وأخطر منه إنه بيبعت توكنات على الشبكة خام.
  for (const app of ['customer-app', 'technician-app']) {
    const hits = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.dart')) {
          const text = fs.readFileSync(full, 'utf8');
          for (const m of text.matchAll(/http:\/\/[a-zA-Z0-9.-]+/g)) {
            // العناوين المحلية مقبولة: هي القيمة الافتراضية للتطوير، والحارس في `ك-١` بيمنع
            // شحنها في release. أي دومين تاني بـhttp مشكلة حقيقية.
            if (/localhost|127\.0\.0\.1|10\.0\.2\.2|schemas\.android\.com|www\.w3\.org/.test(m[0])) continue;
            hits.push(`${path.relative(ROOT, full)}: ${m[0]}`);
          }
        }
      }
    };
    walk(path.join(ROOT, `apps/${app}/lib`));
    record(
      `ك-٢ ${app}: مفيش عنوان http:// لدومين حقيقي في الكود`,
      hits.length === 0,
      hits.length ? `${hits.slice(0, 3).join('، ')} ❗` : 'كل العناوين إما https أو محلية (محميّة بحارس ك-١)',
    );
  }

  // ---- ك-٣: deep links — أخطر عطل صامت ----
  //
  // الباك-إند بيبعت `deep_link`؛ التطبيق بيوجّه بيه. نمط مبعوت والتطبيق مش عارفه = العميل
  // بيضغط الإشعار وماينفتحش حاجة. مفيش خطأ ومفيش لوج — عطل صامت بالكامل.
  const links = backendDeepLinks();
  record('ك-٣/أ استخرجنا أنماط deep_link من الباك-إند', links.length > 0, `${links.length} نمط: ${links.join('، ')}`);

  for (const app of ['customer-app', 'technician-app']) {
    const patterns = routerPatterns(app);
    if (!patterns) {
      record(`ك-٣ ${app}: فيه راوتر deep link`, false, 'الملف مش موجود ❗');
      continue;
    }
    const unhandled = links.filter((l) => !routerHandles(patterns, l));
    // **مش كل نمط مفروض كل تطبيق يعرفه**: `/technician/...` للفني و`/orders/...` للعميل.
    // بنفلتر على اللي المفروض التطبيق ده يشوفه.
    // **مش كل نمط مفروض كل تطبيق يعرفه**: `/technician/...` للفني، و`/admin/...` و
    // `/security-center/...` بيروحوا **للوحة الأدمن على الويب** مش لأي تطبيق موبايل —
    // حسابهم على التطبيقات بيطلّع بلاغات كاذبة (اتلقط في أول تشغيلة).
    const adminOnly = (l) => l.startsWith('/admin') || l.startsWith('/security-center');
    const relevant = unhandled
      .filter((l) => !adminOnly(l))
      .filter((l) => (app === 'technician-app' ? l.startsWith('/technician') : !l.startsWith('/technician')));
    record(
      `ك-٣ ${app}: كل نمط deep_link يخصّه الراوتر عارف يفتحه`,
      relevant.length === 0,
      relevant.length
        ? `مش متعامَل معاهم: ${relevant.join('، ')} — الإشعار هيتضغط وماينفتحش حاجة ❗`
        : `${patterns.length} نمط في الراوتر بيغطّوا كل اللي بيوصله`,
    );
  }

  // ---- ك-٤: push — الإعداد اللي بلاه الإشعار مايظهرش خالص ----
  for (const app of ['customer-app', 'technician-app']) {
    const manifest = read(`apps/${app}/android/app/src/main/AndroidManifest.xml`);
    const hasPostNotif = !!manifest && manifest.includes('POST_NOTIFICATIONS');
    record(
      `ك-٤/أ ${app}: إذن POST_NOTIFICATIONS معلَن (إجباري على Android 13+)`,
      hasPostNotif,
      hasPostNotif ? 'معلَن' : 'ناقص — مفيش إشعار هيظهر على Android 13+ مهما كان FCM مضبوط ❗',
    );
    const hasChannel = !!manifest && /default_notification_channel_id/.test(manifest);
    record(
      `ك-٤/ب ${app}: قناة إشعارات افتراضية معلَنة (وإلا إشعار الخلفية بيتبلع)`,
      hasChannel,
      hasChannel ? 'معلَنة' : 'ناقصة ❗',
    );
  }

  // ---- ك-٥: CI بيبني release مش debug بس ----
  //
  // `--debug` مابيشغّلش R8 ولا tree-shaking، فكل فئة الأعطال دي بتعدّي.
  const ci = read('.github/workflows/ci.yml');
  const buildsRelease = !!ci && /flutter build apk --release/.test(ci);
  record(
    'ك-٥ CI بيبني نسخة release فعليًا (مش debug بس)',
    buildsRelease,
    buildsRelease ? 'موجود في CI' : '`flutter build apk --debug` بس — R8/tree-shaking مش بيتفحصوا ❗',
  );

  console.log(`\n--- الخلاصة ---`);
  const failures = results.filter((r) => !r.ok);
  console.log(`${results.length - failures.length}/${results.length} نجحوا`);
  if (failures.length) {
    console.log(`\n❌ محتاج تدخّل:`);
    for (const f of failures) console.log(`   • ${f.name}: ${f.detail}`);
  }
  console.log(
    `\nℹ️  **حد الفحص بصراحة**: ده فحص ثابت على الكود. بناء APK حقيقي محتاج Android SDK\n` +
      `   (مش متاح في البيئة دي)، والتشغيل على جهاز فعلي ضد HTTPS حقيقي بند يدوي في\n` +
      `   docs/runbooks/release-verification.md — مكتوب خطوة بخطوة عشان يتنفّذ مش يتفسّر.`,
  );
  process.exit(failures.length ? 1 : 0);
}

main();
