#!/usr/bin/env node
/**
 * **تدقيق شامل لمصفوفة إعدادات المعاينة/التسعير مقابل فلو العميل — حي على API شغّال.**
 *
 * ## المشكلة اللي الملف ده موجود عشانها
 *
 * إعدادات الخدمة (طريقة التسعير × وضع يقين السعر × سياسة مسار التقييم × الصور/المعاينة ×
 * خصم الرسم × أوضاع الحجز) بتتحفظ من لوحة الأدمن، والعميل بيتعامل مع نتيجتها في تطبيق تاني
 * خالص. لما الاتنين بيختلفوا، الأدمن **بيحفظ بنجاح** والعميل **بيتقفل بخطأ**:
 *
 *   • «حصل خطأ غير متوقع» = 500 حقيقي في مسار العميل.
 *   • رفض 400 على تركيبة الأدمن سمح بيها = تناقض بين طبقتين.
 *
 * الاتنين دول عيوب في المنتج مش في استخدام العميل، ومستحيل تتلقط بالتجربة اليدوية:
 * الفضاء أكبر من إن حد يلفّه بإيده.
 *
 * السكريبت ده بيلفّه كله: بيمشي على **كل** تركيبة، يحاول يحفظها كأدمن، ولو اتحفظت بيشغّل
 * فلو العميل الحقيقي عليها (عرض الخدمة، تقدير السعر، معاينة الطلب، إنشاء الطلب بالمسارين).
 * وبيطلع تقرير بالخلايا اللي فيها التناقض.
 *
 * ## الاستخدام
 *
 *   node scripts/audit-booking-flow.js                 # كل التركيبات
 *   node scripts/audit-booking-flow.js --quick         # عيّنة أسرع
 *   API_BASE=http://localhost:3000/api/v1 node scripts/audit-booking-flow.js
 *
 * بيحتاج API شغّال + قاعدة تطوير. **مابيلمسش أي بيانات حقيقية**: بينشئ خدمة اختبار مؤقتة
 * ببادئة `zz-audit-` وبيمسحها هي وطلباتها في الآخر.
 */
const { Client } = require('pg');

const API = process.env.API_BASE || 'http://localhost:3000/api/v1';
const DB_URL = process.env.DATABASE_URL || 'postgres://baytak:baytak@localhost:5432/baytak_main';
const QUICK = process.argv.includes('--quick');
// المسار بيتحل وقت التشغيل — `.dev-logs/api.log` في الجذر مكانش موجود أصلاً (الـharness
// بيكتب في `apps/api/.dev-logs/api.out`)، فالأداة كانت بتقف على «مش لاقي كود OTP».
const { resolveApiLog } = require('./lib/resolve-api-log');
const API_LOG = process.env.API_LOG || resolveApiLog() || `${__dirname}/../.dev-logs/api.log`;

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', B = '\x1b[1m', O = '\x1b[0m';

// ── مساحة الإعدادات اللي بتتحفظ من شاشة الأدمن ──────────────────────────────────
const PRICING_MODELS = ['inspection_then_quote', 'formula'];
const CERTAINTY = ['confirmed_price', 'estimated_range', 'assessment_required'];
const ROUTE_POLICY = ['admin_triage', 'remote_only', 'onsite_only', 'customer_choice'];
const BOOL = [false, true];
const CREDIT = QUICK ? ['none'] : ['none', 'full', 'percentage'];
const BOOKING_MODES = QUICK ? ['individual'] : ['individual', 'team', 'emergency'];

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* رد مش JSON */ }
  return { status: res.status, body: json };
}

/**
 * دخول بالـOTP.
 *
 * الكود متخزّن **مهشّر** في `otp_codes` (زي ما المفروض)، فالمصدر الوحيد للنص الصريح في بيئة
 * التطوير هو لوج الـAPI: `[OTP] <رقم> (<غرض>) [...] → <كود>`. السكريبت بيقرا آخر سطر مطابق
 * بعد ما يطلب الكود — نفس اللي المطوّر بيعمله بإيده مع `tail -f | grep OTP`.
 */
async function login(phone, logPath) {
  // **كاش للتوكن بين التشغيلات.** طلب الـOTP وراه throttle حقيقي (429 بعد محاولات قليلة)،
  // والتدقيق بيتشغّل كذا مرة ورا بعض وقت الإصلاح. التوكن المحفوظ بيتجرّب الأول، وبس لو مرفوض
  // بنطلب كود جديد.
  const cachePath = `${require('node:os').tmpdir()}/baytak-audit-token-${phone.replace(/\D/g, '')}.txt`;
  const fs = require('node:fs');
  try {
    const cached = fs.readFileSync(cachePath, 'utf8').trim();
    if (cached) {
      const probe = await api('/notifications?limit=1', { token: cached });
      if (probe.status !== 401) return cached;
    }
  } catch { /* مفيش كاش */ }

  const token = await freshLogin(phone, logPath);
  try { fs.writeFileSync(cachePath, token, { mode: 0o600 }); } catch { /* الكاش تحسين مش شرط */ }
  return token;
}

async function freshLogin(phone, logPath) {
  const before = readLogSize(logPath);
  const req = await api('/auth/otp/request', { method: 'POST', body: { phone_number: phone, purpose: 'login' } });
  if (req.status >= 400) throw new Error(`طلب OTP لـ${phone} رجّع ${req.status}: ${JSON.stringify(req.body?.error)}`);

  let code = null;
  for (let i = 0; i < 40 && !code; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const tail = readLogFrom(logPath, before);
    const matches = [...tail.matchAll(/\[OTP\] (\+?[0-9]+) \(login\).*?→ ([0-9]{4,8})/g)]
      .filter((m) => m[1] === phone);
    code = matches.length ? matches[matches.length - 1][2] : null;
  }
  if (!code) throw new Error(`مش لاقي كود OTP لـ${phone} في ${logPath} — الـAPI شغّال في وضع تطوير؟`);

  const verify = await api('/auth/otp/verify', { method: 'POST', body: { phone_number: phone, otp_code: code } });
  const token = verify.body?.data?.access_token ?? verify.body?.data?.tokens?.access_token;
  if (!token) throw new Error(`فشل تسجيل دخول ${phone}: ${JSON.stringify(verify.body)}`);
  return token;
}

function readLogSize(p) {
  try { return require('node:fs').statSync(p).size; } catch { return 0; }
}
function readLogFrom(p, from) {
  try {
    const fs = require('node:fs');
    const fd = fs.openSync(p, 'r');
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(Math.max(0, size - from));
    fs.readSync(fd, buf, 0, buf.length, from);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
}

/**
 * بينشئ (أو بيرجّع) حساب أدمن التدقيق ودوره. idempotent بالكامل، ومقصور على صلاحيتين.
 * الرقم ثابت وواضح إنه للأدوات، فمش هيتلبس على حساب حقيقي في أي قايمة.
 */
async function ensureAuditAdmin(db) {
  const phone = '+201500000097';
  const q = (sql, params) => db.query(sql, params).then((r) => r.rows);

  let [user] = await q(`SELECT id, phone_number FROM users WHERE phone_number = $1 AND deleted_at IS NULL`, [phone]);
  if (!user) {
    [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, is_active, phone_verified_at)
       VALUES ($1, 'أدمن تدقيق الفلو (أداة)', 'admin', true, now()) RETURNING id, phone_number`,
      [phone],
    );
  } else {
    await q(`UPDATE users SET is_active = true, user_type = 'admin' WHERE id = $1`, [user.id]);
  }

  let [role] = await q(`SELECT id FROM roles WHERE name = 'flow_audit_tool' AND deleted_at IS NULL`);
  if (!role) {
    [role] = await q(
      `INSERT INTO roles (name, display_name, description, is_super_admin, is_active)
       VALUES ('flow_audit_tool', 'أداة تدقيق فلو الحجز',
               'صلاحية الكتالوج فقط، بلا أي صلاحية مالية — عشان ماتطلبش MFA', false, true)
       RETURNING id`,
    );
  }
  await q(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, p.id FROM permissions p
      WHERE p.name IN ('catalog.manage', 'catalog.view') AND p.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = $1 AND rp.permission_id = p.id)`,
    [role.id],
  );
  await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [user.id, role.id]);
  return user;
}

/** عميل التدقيق + عنوان داخل أول نطاق خدمة. idempotent. */
async function ensureAuditCustomer(db) {
  const phone = '+201500000098';
  const q = (sql, params) => db.query(sql, params).then((r) => r.rows);

  let [user] = await q(`SELECT id, phone_number FROM users WHERE phone_number = $1 AND deleted_at IS NULL`, [phone]);
  if (!user) {
    [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, is_active, phone_verified_at)
       VALUES ($1, 'عميل تدقيق الفلو (أداة)', 'customer', true, now()) RETURNING id, phone_number`,
      [phone],
    );
  } else {
    await q(`UPDATE users SET is_active = true WHERE id = $1`, [user.id]);
  }
  const [profile] = await q(`SELECT id FROM customer_profiles WHERE user_id = $1`, [user.id]);
  if (!profile) await q(`INSERT INTO customer_profiles (user_id) VALUES ($1)`, [user.id]);

  let [address] = await q(`SELECT id FROM addresses WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1`, [user.id]);
  if (!address) {
    // العنوان لازم يقع في مكان النظام شايفه مخدوم، وإلا كل معاينة طلب هتترفض بـ«خارج نطاق
    // الخدمة» ويبقى التدقيق كله بيقيس حاجة تانية.
    //
    // بنقلّد **عنوان موجود فعلاً** بدل ما نحسب مركز نطاق: نطاقات كتير في قواعد التطوير
    // `boundary IS NULL`، فحساب المركز بيرجّع NULL والإدخال بيقع على قيد NOT NULL.
    const [sample] = await q(
      `SELECT city_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
         FROM addresses WHERE deleted_at IS NULL AND location IS NOT NULL AND city_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
    );
    if (!sample) throw new Error('مفيش أي عنوان بإحداثيات ومدينة في القاعدة — التدقيق محتاج واحد يقلّده');
    [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
       VALUES ($1, $2, 'شارع تدقيق الفلو', '1', ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, true)
       RETURNING id`,
      [user.id, sample.city_id, sample.lng, sample.lat],
    );
  }
  return { phone_number: user.phone_number, address_id: address.id };
}

function combos() {
  const out = [];
  for (const pricing_model of PRICING_MODELS)
    for (const price_certainty_mode of CERTAINTY)
      for (const assessment_route_policy of ROUTE_POLICY)
        for (const remote_assessment_enabled of BOOL)
          for (const onsite_assessment_enabled of BOOL)
            for (const assessment_fee_credit_mode of CREDIT)
              out.push({
                pricing_model,
                price_certainty_mode,
                assessment_route_policy,
                remote_assessment_enabled,
                onsite_assessment_enabled,
                assessment_fee_credit_mode,
                assessment_fee_credit_bps: assessment_fee_credit_mode === 'percentage' ? 5000 : 0,
              });
  return out;
}

const label = (c) =>
  c.pricing_model
    ? `${c.pricing_model.padEnd(21)} ${c.price_certainty_mode.padEnd(19)} ${c.assessment_route_policy.padEnd(15)} ` +
      `صور=${c.remote_assessment_enabled ? '✓' : '✗'} موقع=${c.onsite_assessment_enabled ? '✓' : '✗'} خصم=${c.assessment_fee_credit_mode}`
    : Object.entries(c).map(([k, v]) => `${k.replace('allows_', '')}=${v ? '✓' : '✗'}`).join(' ');

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const findings = [];
  const seen = new Map(); // كل (فحص، حالة، رسالة) مميزة — بيوضّح إن الفحوص بتوصل للمنطق المقصود فعلاً
  let serviceId = null;
  let adminAccepted = 0;

  try {
    // **حساب أدمن مخصّص للتدقيق بصلاحية الكتالوج بس** — مش super_admin.
    // السبب مش تفضيل: أي حساب بيملك صلاحية من `MFA_REQUIRED_PERMISSIONS` (وsuper_admin بيملكها
    // كلها) بيطلب إثبات MFA بعد الـOTP، فالسكريبت مايقدرش يكمّل. الحساب ده صلاحيته
    // `catalog.manage`/`catalog.view` بس — بالظبط اللي التدقيق محتاجه، وأقل من كده مايكفيش.
    const admin = await ensureAuditAdmin(db);
    // نفس منطق أدمن التدقيق: عميل مخصّص للأداة بعنوان جاهز. قواعد التطوير مليانة حسابات
    // اختبار بأرقام مش E.164 (`+202mtnfuwoo`) وطلب الـOTP بيرفضها من الـDTO، فالاعتماد على
    // «أول عميل في القاعدة» بيفشل عشوائيًا حسب القاعدة اللي بتشتغل عليها.
    const customer = await ensureAuditCustomer(db);
    if (!admin) throw new Error('مفيش حساب أدمن بصلاحية كاملة');
    if (!customer) throw new Error('مفيش عميل بعنوان محفوظ');

    const adminToken = await login(admin.phone_number, API_LOG);
    const customerToken = await login(customer.phone_number, API_LOG);
    console.log(`${D}أدمن: ${admin.phone_number} · عميل: ${customer.phone_number}${O}\n`);

    const [category] = (await db.query(
      `SELECT id FROM service_categories WHERE deleted_at IS NULL AND is_active ORDER BY created_at LIMIT 1`,
    )).rows;

    // تنضيف خدمات تدقيق قديمة سابت وراها (تشغيل اتقطع قبل الـfinally). البادئة `zz-audit-`
    // مقصورة على الأداة دي، فمفيش أي احتمال تلمس خدمة حقيقية.
    const stale = (await db.query(`SELECT id FROM services WHERE slug LIKE 'zz-audit-%'`)).rows;
    for (const row of stale) {
      await db.query(`DELETE FROM services WHERE id = $1`, [row.id]).catch(() => {});
    }
    if (stale.length) console.log(`${D}اتمسحت ${stale.length} خدمة تدقيق قديمة${O}`);

    const slug = `zz-audit-${Date.now().toString(36)}`;
    const created = await api('/admin/services', {
      method: 'POST', token: adminToken,
      body: {
        category_id: category.id, name_ar: 'خدمة تدقيق مؤقتة', name_en: 'Audit probe', slug,
        pricing_model: 'inspection_then_quote', base_price_cents: 10000,
      },
    });
    serviceId = created.body?.data?.id;
    if (!serviceId) throw new Error(`فشل إنشاء خدمة التدقيق: ${JSON.stringify(created.body)}`);
    console.log(`${D}خدمة التدقيق: ${serviceId}${O}\n`);

    const all = combos();
    console.log(`${B}بيمشي على ${all.length} تركيبة…${O}\n`);

    for (const combo of all) {
      const saved = await api(`/admin/services/${serviceId}`, { method: 'PATCH', token: adminToken, body: combo });
      if (saved.status >= 400) {
        // رفض الأدمن هو السلوك المطلوب لتركيبة متناقضة — بس بيتسجّل عشان نتأكد إن السبب هو
        // قاعدة السياسة فعلاً، مش خطأ في السكريبت خلّى **كل** التركيبات تترفض.
        const key = `الأدمن رفض → ${saved.status}: ${saved.body?.error?.message ?? '?'}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        if (saved.status >= 500) {
          findings.push({ kind: '500', combo, probe: 'حفظ إعدادات الأدمن', status: saved.status, message: saved.body?.error?.message });
        }
        continue;
      }
      adminAccepted += 1;

      const probes = [];
      probes.push(['عرض الخدمة', await api(`/services/${serviceId}`, { token: customerToken })]);
      probes.push(['تقدير السعر', await api(`/services/${serviceId}/estimate`, {
        method: 'POST', token: customerToken, body: { pricing_quantity: 1 },
      })]);
      // **أبعاد الحجز اللي المالك ذكرها صراحةً**: فردي/فريق/طوارئ × مجدول/فوري × المسارين.
      // العطل عند العميل مش بيتحدد من إعدادات التقييم لوحدها — بيتحدد من تقاطعها مع وضع الحجز.
      for (const remote of [false, true]) {
        for (const mode of BOOKING_MODES) {
          probes.push([`معاينة الطلب (${remote ? 'صور' : 'موقع'} · ${mode})`, await api('/orders/preview', {
            method: 'POST', token: customerToken,
            body: {
              service_id: serviceId, address_id: customer.address_id, booking_mode: mode,
              ...(mode === 'emergency' ? {} : { scheduled_at: new Date(Date.now() + 86400000).toISOString() }),
              request_remote_quote: remote,
            },
          })]);
        }
      }

      // خطوات الفلو اللي بعد المعاينة — دي اللي العميل بيتقفل عندها فعلاً وقت التأكيد.
      // معاينة السعر بتعدّي، وبعدها اختيار المنفّذ أو إنشاء الطلب هو اللي بيرمي.
      const scheduledAt = new Date(Date.now() + 86400000).toISOString();
      probes.push(['اختيار المنفّذ (auto)', await api('/orders/match-preview', {
        method: 'POST', token: customerToken,
        body: { service_id: serviceId, address_id: customer.address_id, scheduled_at: scheduledAt, selection_mode: 'auto' },
      })]);
      probes.push(['قايمة الفنيين', await api(`/services/${serviceId}/technicians`, { token: customerToken })]);
      probes.push(['تقدير المدة', await api(`/services/${serviceId}/estimate-duration`, {
        method: 'POST', token: customerToken, body: {},
      })]);
      probes.push(['الإضافات', await api(`/services/${serviceId}/addons`, { token: customerToken })]);
      probes.push(['البيانات القياسية', await api(`/services/${serviceId}/standard-data`, { token: customerToken })]);
      probes.push(['إنشاء الطلب (موقع)', await api('/orders', {
        method: 'POST', token: customerToken,
        body: { service_id: serviceId, address_id: customer.address_id, scheduled_at: scheduledAt },
      })]);

      for (const [name, res] of probes) {
        const key = `${name} → ${res.status}: ${res.body?.error?.message ?? 'ok'}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }

      const detail = probes[0][1].body?.data;
      for (const [name, res] of probes) {
        if (res.status >= 500) {
          findings.push({ kind: '500', combo, probe: name, status: res.status, message: res.body?.error?.message });
        }
      }

      // تناقض العقد: الرد بيقول للعميل «المسار ده متاح» والباك-إند بيرفضه (أو العكس).
      if (detail) {
        const advertised = {
          remote: detail.price_certainty_mode === 'assessment_required'
            && detail.pricing_model === 'inspection_then_quote'
            && detail.remote_assessment_enabled
            && detail.assessment_route_policy !== 'onsite_only',
          onsite: detail.price_certainty_mode === 'assessment_required'
            && detail.onsite_assessment_enabled
            && detail.assessment_route_policy !== 'remote_only',
        };
        const byName = (needle) => probes.filter(([n]) => n.includes(needle)).map(([, r]) => r);
        const previewOnsite = byName('موقع · individual')[0] ?? byName('موقع')[0];
        const previewRemote = byName('صور · individual')[0] ?? byName('صور')[0];
        const routeBlocked = (res) => res.status === 400 && /مسار|التقييم|المعاينة|سياست/.test(res.body?.error?.message ?? '');

        if (advertised.remote && routeBlocked(previewRemote)) {
          findings.push({ kind: 'تناقض', combo, probe: 'مسار الصور معروض ومرفوض', status: previewRemote.status, message: previewRemote.body?.error?.message });
        }
        if (advertised.onsite && routeBlocked(previewOnsite)) {
          findings.push({ kind: 'تناقض', combo, probe: 'مسار الموقع معروض ومرفوض', status: previewOnsite.status, message: previewOnsite.body?.error?.message });
        }
        // خدمة نشطة العميل يشوفها في الكتالوج ومايقدرش يحجزها بأي مسار = طريق مسدود.
        if (detail.is_active && routeBlocked(previewOnsite) && routeBlocked(previewRemote)) {
          findings.push({ kind: 'طريق مسدود', combo, probe: 'الخدمة نشطة ومفيش أي مسار حجز', status: 400, message: `${previewOnsite.body?.error?.message} | ${previewRemote.body?.error?.message}` });
        }
      }
    }

    // ── المرحلة ٢: قدرات الحجز ────────────────────────────────────────────────
    // البُعد ده مستقل تمامًا عن سياسة التقييم: الأدمن بيقفل/يفتح «فردي / فريق / طوارئ /
    // جدولة» و«الكاش» و«العربون». وضع الحجز **ناتج محسوب** (ADR-0048) مش اختيار من العميل،
    // فتركيبة زي «كله مقفول» مالهاش أي رفض عند الحفظ — والعميل هو اللي بيكتشفها.
    console.log(`\n${B}المرحلة ٢: قدرات الحجز${O}\n`);
    await api(`/admin/services/${serviceId}`, {
      method: 'PATCH', token: adminToken,
      body: { price_certainty_mode: 'confirmed_price', assessment_route_policy: 'admin_triage',
              remote_assessment_enabled: false, onsite_assessment_enabled: false },
    });

    for (const allows_individual of BOOL)
      for (const allows_team of BOOL)
        for (const allows_emergency of BOOL)
          for (const allows_scheduling of BOOL) {
            const caps = { allows_individual, allows_team, allows_emergency, allows_scheduling };
            const saved = await api(`/admin/services/${serviceId}`, { method: 'PATCH', token: adminToken, body: caps });
            const capLabel = `فردي=${allows_individual ? '✓' : '✗'} فريق=${allows_team ? '✓' : '✗'} طوارئ=${allows_emergency ? '✓' : '✗'} جدولة=${allows_scheduling ? '✓' : '✗'}`;
            if (saved.status >= 400) {
              seen.set(`الأدمن رفض قدرات → ${saved.status}: ${saved.body?.error?.message}`, 1);
              continue;
            }
            adminAccepted += 1;

            // اليوم (استعجالي) + بكرة (مجدول) — الاتنين مسارات حقيقية في التطبيق.
            const attempts = [
              ['النهارده', new Date(Date.now() + 3 * 3600_000).toISOString()],
              ['بكرة', new Date(Date.now() + 86400_000).toISOString()],
            ];
            const results = [];
            for (const [when, at] of attempts) {
              const r = await api('/orders/preview', {
                method: 'POST', token: customerToken,
                body: { service_id: serviceId, address_id: customer.address_id, scheduled_at: at },
              });
              results.push([when, r]);
              seen.set(`قدرات · ${when} → ${r.status}: ${r.body?.error?.message ?? 'ok'}`, (seen.get(`قدرات · ${when} → ${r.status}: ${r.body?.error?.message ?? 'ok'}`) ?? 0) + 1);
              if (r.status >= 500) {
                findings.push({ kind: '500', combo: caps, probe: `معاينة (${when})`, status: r.status, message: r.body?.error?.message });
              }
            }
            // خدمة نشطة ومفيش أي وقت العميل يقدر يحجز فيه = طريق مسدود كامل.
            if (results.every(([, r]) => r.status >= 400)) {
              findings.push({
                kind: 'طريق مسدود', combo: caps, probe: 'الأدمن حفظ قدرات مفيش معاها أي وقت حجز',
                status: results[0][1].status,
                message: results.map(([w, r]) => `${w}: ${r.body?.error?.message}`).join(' | '),
              });
            }
          }
  } finally {
    if (serviceId) {
      await db.query(`DELETE FROM service_pricing_evaluations WHERE service_id = $1`, [serviceId]).catch(() => {});
      await db.query(`DELETE FROM services WHERE id = $1`, [serviceId]).catch(() => {});
    }
    await db.end();
  }

  if (process.argv.includes('--verbose')) {
    console.log(`\n${B}═══ كل الردود المميزة ═══${O}`);
    for (const [k, n] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${D}×${String(n).padEnd(4)}${O} ${k}`);
    }
  }

  console.log(`\n${B}═══ النتيجة ═══${O}\n`);
  console.log(`${D}تركيبات الأدمن قبلها: ${adminAccepted}${O}`);
  if (findings.length === 0) {
    console.log(`${G}✅ مفيش أي تركيبة الأدمن بيقبلها والعميل بيتقفل عليها.${O}\n`);
    return;
  }
  const byKind = findings.reduce((acc, f) => ((acc[f.kind] ??= []).push(f), acc), {});
  for (const [kind, list] of Object.entries(byKind)) {
    console.log(`${R}${kind} — ${list.length}${O}`);
    for (const f of list.slice(0, 12)) {
      console.log(`  ${label(f.combo)}`);
      console.log(`    ${D}${f.probe} → ${f.status}: ${f.message}${O}`);
    }
    if (list.length > 12) console.log(`  ${D}… و${list.length - 12} غيرهم${O}`);
    console.log();
  }
  process.exitCode = 1;
}

main().catch((e) => { console.error(`${R}❌ ${e.message}${O}`); process.exit(1); });
