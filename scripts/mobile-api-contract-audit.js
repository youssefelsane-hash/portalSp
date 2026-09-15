'use strict';
/**
 * **تدقيق العقد بين تطبيقات Flutter والـAPI** — الأداة اللي كانت هتمنع بلاغ المالك 2026-09-13.
 *
 * ## المشكلة اللي الأداة دي بتحلها
 *
 * ADR-0084 §2 خلّى `description` إجباري في `QuoteItemDto`. الباك-إند كله عدّى نضيف:
 * `tsc` + `eslint` + `nest build` + ٢٢٠٠ اختبار. السبب إن **كل اختبارات الباك-إند بتبني
 * الحمولة من الـDTO نفسه** — الحقل بقى إجباري، فالاختبارات اتعدّلت معاه واتفقوا على نفس
 * الغلط. محدش اختبر السؤال الحقيقي: *هل تطبيق الفني بيبعت الحقل ده أصلاً؟* الإجابة كانت لأ،
 * فكل محاولة حقيقية من فني حقيقي بترجع «البيانات المرسلة غير صحيحة».
 *
 * فئة البَقّة اسمها **contract drift**: الطرفين في نفس الـrepo بس مفيش حاجة بتقارنهم. الأداة
 * دي بتقارنهم: بتقرا الحمولة زي ما الـDart بيبنيها بالحرف، وتقراها مقابل الـDTO المربوط
 * بالمسار في الـcontroller، وتقول أي حقل **إجباري في السيرفر ومش مبعوت (أو مبعوت بشرط)**
 * من التطبيق.
 *
 * ## حدود الأداة (مذكورة بصراحة عشان محدش يعتمد عليها أكتر من حقها)
 *
 * تحليل نصي (regex)، مش AST. يعني:
 *  - بتمسك الحمولات المكتوبة كـliteral map في الـrepository/الشاشة — وده شكل ٩٥٪ من النداءات هنا.
 *  - الحمولة اللي بتتبني في متغير بعيد وتتمرر بالاسم بتتقال `unresolved` وبتظهر في تقرير منفصل
 *    بدل ما تتبلع بصمت.
 *  - `if (x != null) 'k': v` بيتحسب **مشروط** — وده بالظبط اللي بنحذّر منه لما الحقل إجباري.
 *
 * الاستخدام: `node scripts/mobile-api-contract-audit.js [--verbose]`
 * بيرجع خروج ≠ 0 لو فيه أي حقل إجباري ناقص — جاهز للـCI.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API_SRC = path.join(ROOT, 'apps/api/src');
const APPS = ['apps/technician-app', 'apps/customer-app'];
const VERBOSE = process.argv.includes('--verbose');

// ────────────────────────────────────────────────────────────────────────────
// أدوات عامة
// ────────────────────────────────────────────────────────────────────────────

function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
      walk(full, filter, out);
    } else if (filter(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** بيشيل التعليقات عشان `//  body: {...}` المعطّل ما يتحسبش نداء حقيقي. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** بيرجّع النص جوه القوس اللي بيبدأ من `openIdx` (لازم يكون على القوس نفسه). */
function balanced(src, openIdx, open = '{', close = '}') {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}

/** `/technician/orders/$orderId/quote-items` → `/technician/orders/*​/quote-items` */
function normalizePath(p) {
  return p
    .replace(/\$\{[^}]*\}/g, '*')
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, '*')
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '')
    .replace(/\/\/+/g, '/');
}

/** `:id` و`:opportunityId` → `*` عشان يقابلوا الـDart. */
function normalizeRoute(p) {
  return `/${p}`
    .replace(/:[A-Za-z0-9_]+/g, '*')
    .replace(/\/+$/, '')
    .replace(/\/\/+/g, '/');
}

// ────────────────────────────────────────────────────────────────────────────
// ١) جدول المسارات من الـcontrollers: METHOD + path → اسم الـDTO
// ────────────────────────────────────────────────────────────────────────────

function buildRouteTable() {
  const routes = new Map(); // "POST /technician/orders/*/quote-items" → {dto, file, line}
  for (const file of walk(API_SRC, (n) => n.endsWith('.controller.ts'))) {
    const raw = fs.readFileSync(file, 'utf8');
    const src = stripComments(raw);
    const baseMatch = src.match(/@Controller\(\s*['"]([^'"]*)['"]/);
    if (!baseMatch) continue;
    const base = baseMatch[1];

    const methodRe = /@(Post|Patch|Put|Delete)\(\s*(?:['"]([^'"]*)['"])?\s*\)/g;
    let m;
    while ((m = methodRe.exec(src)) !== null) {
      const httpMethod = m[1].toUpperCase();
      const sub = m[2] ?? '';
      // **توقيع الهاندلر ده بس**: من بعد الديكوريتور لحد أول `{` بتاع جسم الدالة، ومن غير ما
      // نعدّي على الديكوريتور اللي بعده. من غير الحدّين دول، `@Delete()` بلا body بيلقط
      // `@Body()` بتاع الهاندلر اللي تحتيه — وده كان بيطلّع ٨ بلاغات كاذبة.
      const nextDecorator = src.slice(m.index + m[0].length).search(/@(Get|Post|Patch|Put|Delete)\(/);
      const bodyOpen = src.indexOf('{', m.index + m[0].length);
      const limit = Math.min(
        nextDecorator === -1 ? src.length : m.index + m[0].length + nextDecorator,
        bodyOpen === -1 ? src.length : bodyOpen,
      );
      const signature = src.slice(m.index, limit);
      const bodyDto = signature.match(/@Body\(\)\s*\w+\s*:\s*([A-Za-z0-9_]+)/);
      if (!bodyDto) continue;
      const full = normalizeRoute([base, sub].filter(Boolean).join('/'));
      const key = `${httpMethod} ${full}`;
      if (!routes.has(key)) {
        routes.set(key, {
          dto: bodyDto[1],
          file: path.relative(ROOT, file),
          line: raw.slice(0, raw.indexOf(m[0])).split('\n').length,
        });
      }
    }
  }
  return routes;
}

// ────────────────────────────────────────────────────────────────────────────
// ٢) الحقول الإجبارية في كل DTO (مع النزول في الـnested)
// ────────────────────────────────────────────────────────────────────────────

function buildDtoIndex() {
  const index = new Map(); // اسم الكلاس → {body, file}
  for (const file of walk(API_SRC, (n) => n.endsWith('.ts'))) {
    const raw = fs.readFileSync(file, 'utf8');
    const re = /export\s+class\s+([A-Za-z0-9_]+)[^{]*\{/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const openIdx = raw.indexOf('{', m.index + m[0].length - 1);
      const body = balanced(raw, openIdx);
      if (body !== null && !index.has(m[1])) index.set(m[1], { body, raw, file: path.relative(ROOT, file) });
    }
  }
  return index;
}

const VALIDATOR_RE = /@(Is[A-Za-z0-9_]+|Length|MinLength|MaxLength|Min|Max|ValidateNested|ArrayMinSize|ArrayMaxSize|Matches|Type)\b/;

/**
 * بيرجّع `[{ name, path, nested }]` لكل حقل **إجباري**.
 * `path` بيبقى `items[].description` للـnested عشان التقرير يبقى مفهوم.
 */
function requiredFields(dtoName, dtoIndex, prefix = '', seen = new Set()) {
  const entry = dtoIndex.get(dtoName);
  if (!entry || seen.has(dtoName)) return [];
  seen.add(dtoName);
  // بيرث من الأب لو موجود (`extends BaseDto`) — الحقول الإجبارية بتيجي من هناك كمان
  const extendsMatch = entry.raw?.match(new RegExp(`export\\s+class\\s+${dtoName}\\s+extends\\s+([A-Za-z0-9_]+)`));

  const out = [];
  // **بنقسّم جسم الكلاس لقطع، مش بنطابق الديكوريتورات بـregex**: `@Type(() => QuoteItemDto)`
  // فيه أقواس متداخلة، و`\([^)]*\)` بتقف عند أول `)` فتكسر السلسلة وتخلّي الحقل المتداخل
  // يعدّي بصمت — وده كان بيخلّي الأداة تفوّت البَقّة اللي اتعملت عشانها أصلاً.
  // القطعة = النص من نهاية الخاصية السابقة لحد إعلان الخاصية الحالية.
  const body = stripComments(entry.body);
  const propRe = /(?:^|[;\n])\s*([A-Za-z0-9_]+)(\??)\s*[:!]\s*[A-Za-z0-9_[\]<>|' ]+\s*(?:=|;|$)/gm;
  let m;
  let cursor = 0;
  while ((m = propRe.exec(body)) !== null) {
    const decorators = body.slice(cursor, m.index);
    cursor = propRe.lastIndex;
    const name = m[1];
    const optionalMark = m[2] === '?';
    if (!VALIDATOR_RE.test(decorators)) continue;
    if (decorators.includes('@IsOptional')) continue;
    if (optionalMark) continue;

    const nestedType = decorators.match(/@Type\(\(\)\s*=>\s*([A-Za-z0-9_]+)\)/);
    const isArray = /@ValidateNested\(\s*\{\s*each\s*:\s*true/.test(decorators) || /@ArrayMinSize/.test(decorators);
    if (nestedType && dtoIndex.has(nestedType[1])) {
      const childPrefix = `${prefix}${name}${isArray ? '[]' : ''}.`;
      out.push({ name, path: `${prefix}${name}`, container: true });
      out.push(...requiredFields(nestedType[1], dtoIndex, childPrefix, new Set(seen)));
    } else {
      out.push({ name, path: `${prefix}${name}`, container: false });
    }
  }
  if (extendsMatch && dtoIndex.has(extendsMatch[1])) {
    out.push(...requiredFields(extendsMatch[1], dtoIndex, prefix, new Set(seen)));
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// ٣) الحمولات من الـDart
// ────────────────────────────────────────────────────────────────────────────

/**
 * بيستخرج مفاتيح الـmap: `'key':` مع تحديد إذا كانت مشروطة (`if (...) 'key':`).
 * وبينزل جوه أي map متداخلة تحت مفتاح معيّن (زي `'items': [...map((d) => {...})]`).
 */
function extractKeys(mapBody, prefix = '') {
  const keys = [];
  const re = /(?:^|[,{[(]|\s)(if\s*\([^)]*\)\s*)?['"]([A-Za-z0-9_]+)['"]\s*:/g;
  let m;
  while ((m = re.exec(mapBody)) !== null) {
    const conditional = Boolean(m[1]);
    const key = m[2];
    // القيمة بعد النقطتين — لو فيها map literal ننزل جواها
    const valueStart = m.index + m[0].length;
    const rest = mapBody.slice(valueStart);
    const nestedOpen = rest.search(/\S/) >= 0 ? rest.indexOf('{') : -1;
    // بننزل بس لو الـ`{` جاي قبل أي فاصلة على نفس المستوى (يعني القيمة نفسها map/closure)
    const commaIdx = rest.indexOf(',');
    let nestedKeys = [];
    if (nestedOpen !== -1 && (commaIdx === -1 || nestedOpen < commaIdx || /=>\s*\{/.test(rest.slice(0, nestedOpen + 1)))) {
      const inner = balanced(rest, nestedOpen);
      if (inner && /['"][A-Za-z0-9_]+['"]\s*:/.test(inner)) {
        nestedKeys = extractKeys(inner, `${prefix}${key}[].`);
      }
    }
    keys.push({ key: `${prefix}${key}`, conditional });
    keys.push(...nestedKeys);
  }
  return keys;
}

/** بيدوّر على `'<key>': <ident>` جوه ملف عشان يلاقي الـmap اللي اتبنت في مكان تاني. */
function resolveIndirectItems(dartFiles, identHint) {
  for (const { rel, src } of dartFiles) {
    // بنمسك أي map literal في المشروع بيتبني من نفس الاسم — تلميح بس، مش إثبات
    if (new RegExp(`${identHint}\\s*=`).test(src)) return rel;
  }
  return null;
}

function collectDartCalls() {
  const calls = [];
  const dartFiles = [];
  for (const app of APPS) {
    for (const file of walk(path.join(ROOT, app, 'lib'), (n) => n.endsWith('.dart'))) {
      dartFiles.push({ rel: path.relative(ROOT, file), src: stripComments(fs.readFileSync(file, 'utf8')) });
    }
  }

  // `authedRequest('POST', '/path', body: {...})` / `apiRequest('POST', '/path', body: {...})`
  const callRe = /\b(?:authedRequest|apiRequest|authedRequestList|apiRequestList|authedRequestPage)\s*\(\s*['"](GET|POST|PATCH|PUT|DELETE)['"]\s*,\s*['"]([^'"]+)['"]/g;

  for (const { rel, src } of dartFiles) {
    let m;
    while ((m = callRe.exec(src)) !== null) {
      const method = m[1];
      const rawPath = m[2];
      if (method === 'GET') continue;

      // ندوّر على `body:` بعد النداء مباشرة وقبل ما يقفل قوس النداء
      const tail = src.slice(m.index, m.index + 4000);
      const bodyIdx = tail.search(/\bbody\s*:/);
      let keys = [];
      let unresolved = null;
      if (bodyIdx !== -1) {
        const afterBody = tail.slice(bodyIdx + tail.slice(bodyIdx).indexOf(':') + 1);
        const trimmed = afterBody.replace(/^\s*/, '');
        if (trimmed.startsWith('{')) {
          const inner = balanced(trimmed, 0);
          keys = extractKeys(inner ?? '');
        } else {
          unresolved = trimmed.slice(0, 60).split(/[,)\n]/)[0].trim();
        }
      }

      calls.push({
        file: rel,
        method,
        path: normalizePath(rawPath),
        rawPath,
        keys,
        unresolved,
        line: src.slice(0, m.index).split('\n').length,
      });
    }
  }
  return { calls, dartFiles };
}

// ────────────────────────────────────────────────────────────────────────────
// ٤) المقارنة
// ────────────────────────────────────────────────────────────────────────────

function main() {
  const routes = buildRouteTable();
  const dtoIndex = buildDtoIndex();
  const { calls, dartFiles } = collectDartCalls();

  const problems = [];
  const conditional = [];
  const unresolved = [];
  let matched = 0;

  for (const call of calls) {
    const route = routes.get(`${call.method} ${call.path}`);
    if (!route) continue; // مسار بلا @Body() — مفيش عقد يتقارن
    matched += 1;

    const required = requiredFields(route.dto, dtoIndex).filter((f) => !f.container);
    if (required.length === 0) continue;

    if (call.unresolved) {
      unresolved.push({ call, route, required });
      continue;
    }

    const sent = new Map(call.keys.map((k) => [k.key, k.conditional]));
    for (const field of required) {
      // الـnested بيتكتب `items[].description` في الحالتين
      const key = field.path;
      if (!sent.has(key)) {
        problems.push({ call, route, field: key });
      } else if (sent.get(key)) {
        conditional.push({ call, route, field: key });
      }
    }
  }

  console.log('═'.repeat(78));
  console.log('  تدقيق العقد: حمولات Flutter مقابل DTOs الباك-إند');
  console.log('═'.repeat(78));
  console.log(`مسارات فيها @Body() في الباك-إند: ${routes.size}`);
  console.log(`نداءات كتابة من التطبيقين: ${calls.length} (اتقابل منها ${matched} بمسار معروف)`);
  console.log('');

  if (problems.length) {
    console.log(`❌ ${problems.length} حقل إجباري في السيرفر والتطبيق مش بيبعته خالص:`);
    for (const p of problems) {
      console.log(`   • ${p.field}  ←  ${p.route.dto}`);
      console.log(`     التطبيق: ${p.call.file}:${p.call.line}  (${p.call.method} ${p.call.rawPath})`);
      console.log(`     العقد:   ${p.route.file}:${p.route.line}`);
    }
    console.log('');
  } else {
    console.log('✅ مفيش حقل إجباري مفقود بالكامل من أي حمولة');
    console.log('');
  }

  if (conditional.length) {
    console.log(`⚠️  ${conditional.length} حقل إجباري في السيرفر بس التطبيق بيبعته **بشرط**:`);
    console.log('   (يعني لو الشرط مااتحققش الطلب بيترفض 400 — نفس أعراض بلاغ 2026-09-13)');
    for (const c of conditional) {
      console.log(`   • ${c.field}  ←  ${c.route.dto}`);
      console.log(`     التطبيق: ${c.call.file}:${c.call.line}  (${c.call.method} ${c.call.rawPath})`);
    }
    console.log('');
  }

  if (unresolved.length && VERBOSE) {
    console.log(`ℹ️  ${unresolved.length} نداء حمولته مبنية بره النداء (تحليل نصي مش كفاية):`);
    for (const u of unresolved) {
      const hint = resolveIndirectItems(dartFiles, u.call.unresolved) ?? 'غير معروف';
      console.log(`   • ${u.call.file}:${u.call.line} → ${u.route.dto} (المتغير: ${u.call.unresolved}، شوف ${hint})`);
    }
    console.log('');
  } else if (unresolved.length) {
    console.log(`ℹ️  ${unresolved.length} نداء حمولته مبنية بره النداء — شغّل بـ--verbose للتفاصيل`);
    console.log('');
  }

  const failed = problems.length + conditional.length;
  console.log(failed === 0 ? '✅ العقد متطابق' : `❌ ${failed} مشكلة عقد`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
