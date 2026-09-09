#!/usr/bin/env node
/**
 * **سلامة الحجز تحت التزامن** — «٢٠-٤٠ شخص يحاولوا يحجزوا نفس الفني ونفس اليوم».
 *
 * السؤال اللي السكريبت ده بيجاوب عليه بالتشغيل الحي مش بقراءة الكود:
 *
 *   لو N عميل حقيقي بعتوا `POST /orders` في نفس اللحظة، كلهم مصرّين على **نفس الفني** و**نفس
 *   اليوم**، هل الفني ده ممكن يتحمّل فوق سقفه اليومي؟
 *
 * الثابت المقاس (invariant): مجموع دقايق الشغل الملتزم بيه للفني في اليوم ده ≤
 * `matching.daily_capacity_minutes`. أي تجاوز = double booking حقيقي.
 *
 * السكريبت بيمشي على المكدس كامل (HTTP → NestJS → Postgres) عشان يقيس السلوك الحقيقي، مش
 * وحدة معزولة. التوكنات بتتوقّع محليًا بنفس `JWT_ACCESS_SECRET` بدل ٤٠ دورة OTP — ده بيختصر
 * الإعداد بس، الطلب نفسه بيعدّي على كل الحُرّاس زي أي عميل حقيقي.
 *
 *   node scripts/concurrency-booking-safety.js [--concurrency 30] [--keep]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('/home/user/portalSp/node_modules/pg');
const jwt = require('/home/user/portalSp/node_modules/jsonwebtoken');

const ROOT = path.resolve(__dirname, '..');
const API = process.env.API_BASE_URL ?? 'http://localhost:3000/api/v1';

function envFromFile() {
  const out = {};
  const raw = fs.readFileSync(path.join(ROOT, 'apps/api/.env'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const ENV = envFromFile();
const DATABASE_URL = process.env.DATABASE_URL ?? ENV.DATABASE_URL;
const JWT_SECRET = process.env.JWT_ACCESS_SECRET ?? ENV.JWT_ACCESS_SECRET;

const args = process.argv.slice(2);
const CONCURRENCY = Number(args[args.indexOf('--concurrency') + 1]) || 30;
const KEEP = args.includes('--keep');

/** مدة الشغلانة بالدقايق — مقصود إنها تخلي السقف اليومي يسع عدد صغير معروف من الطلبات. */
const JOB_MINUTES = 300;

const runId = Date.now().toString(36);
// أرقام تليفون مصرية صالحة وفريدة: +2010 + خمس خانات للتشغيلة + تلات خانات للفهرس = ١٣ خانة.
// (الصيغة الأولى كانت بتقصّ على ١٤ حرف فبتاكل جزء من مُعرّف التشغيلة وتصطدم بين العملاء.)
const runNum = String(Date.now() % 100000).padStart(5, '0');
let db;

async function q(sql, params) {
  const res = await db.query(sql, params);
  return res.rows;
}

/**
 * حذف صفوف من جدول أب مع كل اللي بيشاور عليها — **بسؤال `pg_constraint`، مش بقايمة مكتوبة**.
 *
 * نفس فلسفة `scripts/clean-test-data.js` (docs/08 §132) بس معمّمة على أي جدول. حذف مستخدمي
 * الاختبار بالإيد فشل على `notifications` ثم `notification_workflows` ثم `booking_funnel_events`
 * — كل واحد تشغيلة ضايعة. القايمة المكتوبة بالإيد بتقدم مع كل موديول جديد؛ الكتالوج لأ.
 */
async function cascadeDelete(table, ids) {
  if (!ids.length) return;
  const refs = await q(
    `SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
       FROM pg_constraint c
       JOIN unnest(c.conkey) k(attnum) ON true
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f' AND c.confrelid = $1::regclass AND c.confdeltype = 'a'`,
    [table],
  );
  for (const ref of refs) {
    if (ref.table_name === table) continue; // مراجع ذاتية بتتحل بحذف الصف نفسه
    await q(`DELETE FROM ${ref.table_name} WHERE ${ref.column_name} = ANY($1::uuid[])`, [ids]);
  }
  await q(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [ids]);
}

async function api(pathname, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  const text = await res.text();
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 400) };
  }
  return { status: res.status, body: parsed };
}

function tokenFor(userId) {
  return jwt.sign({ sub: userId, userType: 'customer', amr: ['otp'] }, JWT_SECRET, { expiresIn: '30m' });
}

/** اليوم المستهدف — بعيد كفاية عن عتبة «الشغل القريب» (٤٨ ساعة) عشان يمشي في مسار التأكيد التلقائي. */
function targetDay() {
  const d = new Date(Date.now() + 5 * 86_400_000);
  return `${d.toISOString().slice(0, 10)}T09:00:00.000Z`;
}

const created = { users: [], orders: [] };

async function seed() {
  const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
  const [city] = await q(
    `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
    [country.id, `مدينة تزامن ${runId}`, `Conc City ${runId}`, `conc-city-${runId}`],
  );
  const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
    city.id,
    `نطاق تزامن ${runId}`,
    `Conc Zone ${runId}`,
  ]);
  const [category] = await q(
    `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
    [`فئة تزامن ${runId}`, `Conc Cat ${runId}`, `conc-cat-${runId}`],
  );
  const [service] = await q(
    `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents,
        estimated_duration_minutes, is_active, allows_individual, allows_team, allows_emergency, allows_scheduling)
     VALUES ($1,$2,$3,'formula',10000,$4,true,true,false,true,true) RETURNING id`,
    [category.id, `خدمة تزامن ${runId}`, `conc-service-${runId}`, JOB_MINUTES],
  );

  // الفني الوحيد اللي كل العملاء هيتخانقوا عليه.
  const [techUser] = await q(
    `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
    [`+2010${runNum}999`, `فني تزامن ${runId}`],
  );
  created.users.push(techUser.id);
  const [tech] = await q(
    `INSERT INTO technician_profiles
       (user_id, technician_code, current_level, verification_status, is_available, is_on_duty,
        technician_kind, current_location)
     VALUES ($1,$2,'premium','approved',true,true,'technician',
             ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
    [techUser.id, `CONC${runId}`.slice(0, 20)],
  );
  await q(
    `INSERT INTO technician_services (technician_id, service_id, is_active, verification_status)
     VALUES ($1,$2,true,'approved')`,
    [tech.id, service.id],
  );
  await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [
    tech.id,
    zone.id,
  ]);

  // العملاء — كل واحد بعنوان في نفس النطاق.
  const customers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2010${runNum}${String(i).padStart(3, '0')}`, `عميل تزامن ${i}`],
    );
    created.users.push(user.id);
    const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [user.id]);
    // النطاق مش عمود في `addresses` — بيتشتق وقت الحجز من (city_id + الإحداثيات) عبر
    // `GeoService.findZoneForPoint`. المدينة دي فيها نطاق واحد بلا boundary، فالـfallback
    // بيرجّعه حتميًا.
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
       VALUES ($1,$2,$3,'1',ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography,true) RETURNING id`,
      [user.id, city.id, `شارع تزامن ${i}`],
    );
    customers.push({ userId: user.id, profileId: profile.id, addressId: address.id, token: tokenFor(user.id) });
  }

  const [cap] = await q(`SELECT value FROM settings WHERE key = 'matching.daily_capacity_minutes'`);
  const dailyCapacity = Number(cap?.value ?? 720);

  return { zone, service, tech, customers, dailyCapacity };
}

/**
 * الانتظار لحد ما شغل التوزيع الخلفي من أي تشغيلة سابقة يخلص.
 *
 * من غير ده القياس بيبقى بلا معنى: تشغيلة ورا تشغيلة كانت بتدّي «١٥٠ متزامن = كله فشل» و«٣٠٠
 * متزامن = كله نجح» في نفس الدقيقة — لأن الأولى كانت بتتقاس والسيرفر لسه بيصرّف طابور اللي
 * قبلها. الرقم اللي بيتقاس لازم يكون قدرة النظام، مش بقايا القياس اللي فات.
 */
async function waitForIdleSystem() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const [{ busy }] = await q(
      `SELECT count(*)::int AS busy FROM pg_stat_activity
        WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid()`,
    );
    if (busy <= 1) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('⚠️  النظام لسه مشغول بعد ٦٠ ثانية — القياس ممكن يكون متأثر.');
}

async function run() {
  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  await waitForIdleSystem();

  console.log(`\n=== سلامة الحجز تحت التزامن — ${CONCURRENCY} عميل على فني واحد ===`);
  const seeded = await seed();
  const day = targetDay();
  console.log(`الفني: ${seeded.tech.id}`);
  console.log(`السقف اليومي: ${seeded.dailyCapacity} دقيقة | مدة الشغلانة: ${JOB_MINUTES} دقيقة`);
  console.log(`أقصى عدد طلبات مسموح للفني في اليوم ده: ${Math.floor(seeded.dailyCapacity / JOB_MINUTES)}`);
  console.log(`اليوم المستهدف: ${day}\n`);

  const t0 = Date.now();
  const results = await Promise.all(
    seeded.customers.map((c) =>
      api('/orders', {
        method: 'POST',
        token: c.token,
        body: {
          service_id: seeded.service.id,
          address_id: c.addressId,
          scheduled_at: day,
          requested_technician_id: seeded.tech.id,
          // كاش = غياب وسيلة دفع مسبق (P2-3) — إرسال `payment_method: 'cash'` بيترفض صراحةً.
          problem_description: 'اختبار تزامن — كل العملاء على نفس الفني ونفس اليوم',
        },
      }),
    ),
  );
  const elapsed = Date.now() - t0;

  const byStatus = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  console.log(`زمن الدفعة كلها: ${elapsed}ms`);
  console.log(`توزيع أكواد الرد: ${JSON.stringify(byStatus)}`);

  const sample5xx = results.find((r) => r.status >= 500);
  if (sample5xx) console.log(`⚠️  رد 5xx: ${JSON.stringify(sample5xx.body).slice(0, 300)}`);
  const sample4xx = results.find((r) => r.status >= 400 && r.status < 500);
  if (sample4xx) console.log(`رسالة الرفض النموذجية: ${JSON.stringify(sample4xx.body?.error ?? sample4xx.body).slice(0, 300)}`);

  for (const r of results) {
    const id = r.body?.data?.id;
    if (id) created.orders.push(id);
  }
  console.log(`طلبات اتعملت فعلاً: ${created.orders.length}`);

  // التوزيع غير متزامن (event → queue) — بنستنى لحد ما الحالات تستقر.
  let settled = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    const rows = await q(
      `SELECT order_status, count(*)::int AS n FROM orders WHERE id = ANY($1::uuid[]) GROUP BY 1 ORDER BY 1`,
      [created.orders],
    );
    const searching = rows.find((r) => r.order_status === 'searching_technician')?.n ?? 0;
    settled = rows;
    if (searching === 0) break;
  }
  console.log(`\nحالات الطلبات بعد استقرار التوزيع: ${JSON.stringify(settled)}`);

  // ===== الثابت الحاكم: مجموع دقايق الشغل الملتزم بيه للفني في اليوم ده =====
  const [load] = await q(
    `SELECT COALESCE(SUM(COALESCE(o.duration_minutes, o.duration_hours * 60,
                                  (SELECT estimated_duration_minutes FROM services WHERE id = o.service_id), 60)), 0)::int AS busy_minutes,
            count(*)::int AS committed_orders
     FROM orders o
     WHERE o.technician_id = $1
       AND o.deleted_at IS NULL
       AND o.order_status = ANY($2::order_status[])
       AND (COALESCE(o.scheduled_at, now()) AT TIME ZONE 'Africa/Cairo')::date
           = ($3::timestamptz AT TIME ZONE 'Africa/Cairo')::date`,
    [
      seeded.tech.id,
      ['accepted', 'technician_on_way', 'technician_arrived', 'in_progress', 'awaiting_quote_approval', 'awaiting_initial_quote_approval'],
      day,
    ],
  );

  // الطلبات المعروضة على الفني ومستنية موافقته — مش ملتزم بيها لسه، بس لو عددها أكبر من
  // الطاقة المتبقية فالسقف ممكن يتخطى وقت القبول. بنقيسها كمان.
  const [pending] = await q(
    `SELECT count(*)::int AS n FROM orders o
     WHERE o.technician_id = $1 AND o.deleted_at IS NULL AND o.order_status = 'technician_assigned'`,
    [seeded.tech.id],
  );
  const [offers] = await q(
    `SELECT count(*)::int AS n FROM order_assignments oa
     JOIN orders o ON o.id = oa.order_id
     WHERE oa.technician_id = $1 AND oa.assignment_status = 'sent' AND o.id = ANY($2::uuid[])`,
    [seeded.tech.id, created.orders],
  );

  const maxAllowed = seeded.dailyCapacity;
  console.log(`\n--- النتيجة ---`);
  console.log(`طلبات ملتزم بيها الفني في اليوم: ${load.committed_orders}`);
  console.log(`مجموع الدقايق: ${load.busy_minutes} / السقف ${maxAllowed}`);
  console.log(`طلبات معيّنة عليه ومستنية قبوله: ${pending.n}`);
  console.log(`عروض مفتوحة (sent) عليه من الدفعة دي: ${offers.n}`);

  const overbooked = load.busy_minutes > maxAllowed;
  const has5xx = results.some((r) => r.status >= 500);

  console.log(`\n${overbooked ? '❌ DOUBLE BOOKING — الفني اتحمّل فوق سقفه' : '✅ مفيش double booking — السقف اليومي اتحترم'}`);
  console.log(`${has5xx ? '❌ في ردود 5xx تحت الضغط' : '✅ صفر 5xx تحت الضغط'}`);

  if (!KEEP) {
    console.log(`\nتنظيف...`);
    // حذف الطلبات بترتيب آمن للـFK عبر `clean-test-data.js` (docs/08 §132) — بيسأل
    // `pg_constraint` عن الجداول المرتبطة فعلاً بدل قايمة مكتوبة بالإيد بتقدم مع الوقت
    // (`chat_threads` و`booking_funnel_events` وغيرهم لقطناهم بالطريقة الصعبة).
    //
    // **بيتنادى بالخدمة مش بقايمة المعرّفات اللي رجعت في الردود**: رد 503 ممكن يجي بعد ما
    // الطلب اتحفظ فعلاً، فبيبقى في `orders` صفوف مالهاش معرّف عندنا.
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/clean-test-data.js'), '--service', seeded.service.id], {
      env: { ...process.env, DATABASE_URL },
      stdio: 'pipe',
    });
    await cascadeDelete('technician_profiles', [seeded.tech.id]);
    await cascadeDelete('users', created.users);
    await q(`DELETE FROM services WHERE id = $1`, [seeded.service.id]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [seeded.zone.id]);
  } else {
    console.log(`\n--keep: البيانات سايبها (فني ${seeded.tech.id})`);
  }

  await db.end();
  process.exit(overbooked || has5xx ? 1 : 0);
}

run().catch(async (err) => {
  console.error('فشل:', err);
  try {
    await db?.end();
  } catch {
    /* الإغلاق مش مهم لو الاتصال اتقطع أصلاً */
  }
  process.exit(2);
});
