#!/usr/bin/env node
/**
 * **ج-٢ — idempotency مالي كامل**، مقاس حيًا على المكدس كامل (HTTP → NestJS → Postgres).
 *
 * الأسئلة اللي السكريبت ده بيجاوب عليها بالتشغيل مش بقراءة الكود:
 *
 *   ١. نفس طلب الدفع اتبعت N مرة في نفس اللحظة بنفس `Idempotency-Key` — العميل بيتخصم مرة ولا N؟
 *   ٢. نفس الطلب بمفاتيح مختلفة (نقر متكرر بعد فشل شبكة) — دفعتين ناجحتين ولا واحدة؟
 *   ٣. رصيد يكفي طلب واحد بس وطلبين متزامنين — الرصيد بيروح سالب؟
 *   ٤. البوابة بعتت نفس الـwebhook خمس مرات (سلوكها القياسي لما ماتوصلهاش 200) — خمس تسويات؟
 *   ٥. أدمن ضغط «استرداد» مرتين في نفس اللحظة — استردادين؟
 *   ٦. طلب مدفوع مسبقًا اتلغى — مجموع القيود بيقفل على صفر ولا فيه فلوس اتخلقت/ضاعت؟
 *
 * الثوابت المقاسة بعد كل سيناريو (invariants) — كلها من الدفتر نفسه مش من رد الـAPI:
 *   • مجموع كل قيود المحفظة (debit − credit) على مستوى النظام = صفر دايمًا (قيد مزدوج سليم).
 *   • مفيش `wallets.balance_cents` أو `reserved_balance_cents` بالسالب.
 *   • عدد الدفعات الناجحة للطلب الواحد ≤ ١ (ما لم يكن الطلب فيه شغل إضافي مقصود).
 *   • المخصوم من محفظة العميل = مجموع الدفعات الناجحة بالمحفظة، بالحرف.
 *
 *   node scripts/financial-idempotency-audit.js [--only S1,S4] [--keep]
 *
 * محتاج API شغّال (`scripts/dev-api.sh start`) وPostgres/Redis. بيمسح بياناته وراه.
 * سيناريو الـwebhook (S4) بيحتاج بوابة Paymob «مُعدّة» — السكريبت بيزرع اعتمادات وهمية في
 * `settings` ويعيد تشغيل الـAPI، وبيرجّعها زي ما كانت في الآخر (`finally`، حتى لو فشل).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
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
const KEEP = args.includes('--keep');
const ONLY = (() => {
  const i = args.indexOf('--only');
  return i > -1 ? new Set(args[i + 1].split(',').map((s) => s.trim().toUpperCase())) : null;
})();
const wanted = (id) => !ONLY || ONLY.has(id);

const PAYMOB_TEST_HMAC = 'baytak-test-hmac-secret';
const PRICE_CENTS = 10_000; // ١٠٠ جنيه — بيتحدد من `services.base_price_cents` تحت.

const runId = Date.now().toString(36);
const runNum = String(Date.now() % 100000).padStart(5, '0');
let db;
let phoneSeq = 0;

const findings = [];
const results = [];

function record(scenario, ok, detail) {
  results.push({ scenario, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${scenario} — ${detail}`);
  if (!ok) findings.push(`${scenario}: ${detail}`);
}

async function q(sql, params) {
  return (await db.query(sql, params)).rows;
}

/**
 * حذف صف أب مع كل اللي بيشاور عليه — بسؤال `pg_constraint` مش بقايمة مكتوبة بالإيد، و**بالتعمّق**:
 * `wallet_transactions` بتشاور على `wallets` اللي بتشاور على `users`، فحذف المستخدم بمستوى واحد
 * بيفشل على `wallet_transactions_wallet_id_fkey`. المستوى الواحد كان بيمشي في `concurrency-booking-safety`
 * لأن مفيش قيود محافظ هناك أصلاً؛ هنا الفلوس هي الموضوع.
 */
async function cascadeDelete(table, ids, depth = 0) {
  if (!ids.length || depth > 4) return;
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
    // `audit_logs` append-only بقرار معماري (trigger بيرفض DELETE صراحةً) — فأي مستخدم كتب
    // سجل تدقيق (أدمن الاختبار مثلاً) مش هينحذف، وده مقصود مش عطل تنظيف.
    if (ref.table_name === 'audit_logs') continue;
    const rows = await q(
      `SELECT id FROM ${ref.table_name} WHERE ${ref.column_name} = ANY($1::uuid[])`,
      [ids],
    ).catch(() => null); // جدول بلا عمود `id` (زي user_roles) — بيتحذف مباشرةً تحت
    if (rows && rows.length) {
      await cascadeDelete(ref.table_name, rows.map((r) => r.id), depth + 1);
    } else {
      await q(`DELETE FROM ${ref.table_name} WHERE ${ref.column_name} = ANY($1::uuid[])`, [ids]);
    }
  }
  await q(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [ids]);
}

async function api(pathname, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 400) };
  }
  return { status: res.status, body: parsed };
}

function tokenFor(userId, userType = 'customer') {
  return jwt.sign({ sub: userId, userType, amr: ['otp'] }, JWT_SECRET, { expiresIn: '30m' });
}

function nextPhone() {
  return `+2010${runNum}${String(phoneSeq++).padStart(3, '0')}`;
}

/**
 * **كل طلب اختبار بياخد يوم لوحده.**
 *
 * السقف اليومي للفني (`matching.daily_capacity_minutes`، ٧٢٠ دقيقة) مشترك بين كل الطلبات على
 * نفس اليوم. لما كل السيناريوهات كانت بتحجز نفس اليوم، الفني كان بيتملي بعد تلات-أربع طلبات
 * فالسيناريو الخامس يفضل `searching_technician` للأبد — وده كان بيبان كأنه «التوزيع واقف»
 * بينما هو رفض صحيح تمامًا من محرك المطابقة. فصل الأيام بيخلي كل سيناريو يقيس اللي بيقيسه هو.
 */
let dayCursor = 5;
function futureDay(days = dayCursor++) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10) + 'T09:00:00.000Z';
}

// ===================== ثوابت الدفتر =====================

/**
 * الثابت الأهم في أي نظام مالي: مجموع القيود (debit − credit) لازم يساوي صفر — كل قرش خرج من
 * محفظة دخل تانية.
 *
 * **بيتقاس على قيود التشغيلة دي وحدها، مش على الجدول كله**، وده مقصود: قاعدة التطوير فيها
 * ٤٥٠٠+ قيد نصّهم التاني اتمسح مع تنظيف مستخدمي تشغيلات قديمة (حذف المستخدم بيجرّ محفظته
 * وقيودها، وطرف المنصة بيفضل يتيم). يعني «اختلال» الجدول كله رقم بلا معنى هنا — أثر تنظيف،
 * مش خلل منتج. الأرقام المرجعية وقت الكتابة: ٤٥٢٢ credit / ٤٨٨٣ debit كلهم تقريبًا على محفظة
 * المنصة، وأربع محافظ بس فيها قيود من أصل ٥٥.
 */
async function ledgerImbalance(since) {
  const [row] = await q(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE -amount_cents END), 0)::bigint AS net,
            count(*)::int AS n
       FROM wallet_transactions
      WHERE created_at >= $1`,
    [since],
  );
  return { net: Number(row.net), rows: row.n };
}

/**
 * محافظ التشغيلة دي وحدها. محفظة المنصة **مستثناة عمدًا**: خصومات النظام (عمولة الكاش مثلاً)
 * بتمرّ بـ`allowNegativeBalance: true` بتصميمها، فرصيدها السالب سلوك مقصود مش خلل. الممنوع
 * قطعًا هو رصيد عميل أو فني بالسالب — ده معناه إن النظام صرف فلوس مش موجودة.
 */
async function negativeBalances(userIds) {
  if (!userIds.length) return [];
  return q(
    `SELECT id, owner_user_id, owner_type, balance_cents, reserved_balance_cents FROM wallets
      WHERE owner_user_id = ANY($1::uuid[])
        AND owner_type <> 'platform'
        AND (balance_cents < 0 OR reserved_balance_cents < 0)`,
    [userIds],
  );
}

async function walletOf(userId) {
  const [w] = await q(`SELECT id, balance_cents, reserved_balance_cents FROM wallets WHERE owner_user_id = $1`, [userId]);
  return w;
}

async function fundWallet(userId, cents) {
  await q(
    `INSERT INTO wallets (owner_user_id, owner_type, balance_cents) VALUES ($1,'customer',$2)
     ON CONFLICT (owner_user_id) DO UPDATE SET balance_cents = EXCLUDED.balance_cents`,
    [userId, cents],
  );
}

// ===================== الإعداد =====================

const created = { users: [], orders: [], serviceIds: [], zoneIds: [], cityIds: [], categoryIds: [] };

async function seedCatalog() {
  const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
  const [city] = await q(
    `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
    [country.id, `مدينة مالية ${runId}`, `Fin City ${runId}`, `fin-city-${runId}`],
  );
  created.cityIds.push(city.id);
  const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
    city.id,
    `نطاق مالي ${runId}`,
    `Fin Zone ${runId}`,
  ]);
  created.zoneIds.push(zone.id);
  const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
    `فئة مالية ${runId}`,
    `Fin Cat ${runId}`,
    `fin-cat-${runId}`,
  ]);
  created.categoryIds.push(category.id);
  const [service] = await q(
    `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents,
        estimated_duration_minutes, is_active, allows_individual, allows_team, allows_emergency, allows_scheduling)
     VALUES ($1,$2,$3,'formula',$4,60,true,true,false,true,true) RETURNING id`,
    [category.id, `خدمة مالية ${runId}`, `fin-service-${runId}`, PRICE_CENTS],
  );
  created.serviceIds.push(service.id);

  const [techUser] = await q(
    `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
    [nextPhone(), `فني مالي ${runId}`],
  );
  created.users.push(techUser.id);
  const [tech] = await q(
    `INSERT INTO technician_profiles
       (user_id, technician_code, current_level, verification_status, is_available, is_on_duty,
        technician_kind, current_location)
     VALUES ($1,$2,'premium','approved',true,true,'technician',
             ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
    [techUser.id, `FIN${runId}`.slice(0, 20)],
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

  return { city, zone, category, service, tech, techUserId: techUser.id };
}

async function makeCustomer(cityId, label) {
  const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
    nextPhone(),
    `عميل ${label} ${runId}`,
  ]);
  created.users.push(user.id);
  const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [user.id]);
  const [address] = await q(
    `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
     VALUES ($1,$2,$3,'1',ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography,true) RETURNING id`,
    [user.id, cityId, `شارع ${label}`],
  );
  return { userId: user.id, profileId: profile.id, addressId: address.id, token: tokenFor(user.id) };
}

/** أدمن super_admin — عشان مسارات الاسترداد/التسوية. */
async function makeAdmin() {
  const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
    nextPhone(),
    `أدمن مالي ${runId}`,
  ]);
  created.users.push(user.id);
  let [role] = await q(`SELECT id FROM roles WHERE is_super_admin = true AND deleted_at IS NULL LIMIT 1`);
  if (!role) {
    [role] = await q(
      `INSERT INTO roles (name, description_ar, is_super_admin, is_active)
       VALUES ($1,'اختبار مالي', true, true) RETURNING id`,
      [`super_admin_${runId}`],
    );
  }
  await q(
    `INSERT INTO employee_profiles (user_id, employee_code, department, is_active)
     VALUES ($1,$2,'finance',true)`,
    [user.id, `FINADM${runId}`.slice(0, 20)],
  );
  // الدور بيتربط في `user_roles` مش في بروفايل الموظف — الفصل ده هو اللي بيخلي مستخدم واحد
  // يشيل أكتر من دور، وهو المصدر اللي `PermissionsGuard` بيقرا منه.
  await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [user.id, role.id]);
  return { userId: user.id, token: tokenFor(user.id, 'admin') };
}

/**
 * توكن step-up لكل نداء حسّاس. الـguard بيستهلكه مرة واحدة ذرّيًا (`used_at IS NULL`)، فكل
 * محاولة متزامنة لازم يكون معاها توكن خاص بيها — وده كمان الاختبار الأقوى: بيشيل الـstep-up
 * من المعادلة تمامًا فيفضل الحارس المالي وحده هو اللي بيمنع الاسترداد المزدوج.
 */
async function stepUpToken(userId) {
  const [row] = await q(
    `INSERT INTO step_up_tokens (user_id, expires_at) VALUES ($1, now() + interval '10 minutes') RETURNING id`,
    [userId],
  );
  return row.id;
}

async function createOrder(customer, serviceId, extra = {}) {
  const res = await api('/orders', {
    method: 'POST',
    token: customer.token,
    body: {
      service_id: serviceId,
      address_id: customer.addressId,
      scheduled_at: futureDay(),
      problem_description: 'اختبار idempotency مالي',
      ...extra,
    },
  });
  if (res.status !== 201) throw new Error(`فشل إنشاء الطلب: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  created.orders.push(res.body.data.id);
  return res.body.data;
}

/**
 * الطلب لازم يوصل حالة قابلة للدفع (`work_completed`) عشان مسار الدفع بالمحفظة يشتغل. بننتظر
 * التوزيع الخلفي يخلص الأول (`technician_id` بيتملي) عشان التسوية تلاقي فني تحسبله أرباحه —
 * تسوية بلا فني بتعدّي بس بتقيس حاجة تانية غير اللي إحنا بنقيسه.
 */
async function driveToPayable(orderId) {
  let technicianId = null;
  for (let i = 0; i < 60; i++) {
    const [row] = await q(`SELECT technician_id FROM orders WHERE id = $1`, [orderId]);
    technicianId = row?.technician_id ?? null;
    if (technicianId) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  // **بنفشل بصوت عالي لو التوزيع ماخلصش.** الأول كان بيدفع الطلب لـ`work_completed` بلا فني
  // على أي حال، فالتسوية كانت بترمي «V2 paid worker pool requires at least one participant»
  // والسيناريو بيتحوّل لقياس حالة بيانات مستحيلة بدل ما بنقيسه فعلاً. الانتظار ٣٠ ثانية كفاية
  // بفارق كبير — التوزيع بياخد أقل من ثانية في القياسات الطبيعية.
  if (!technicianId) {
    throw new Error(`التوزيع ماخلصش للطلب ${orderId} خلال ٣٠ ثانية — السيناريو مش صالح للقياس`);
  }
  await q(
    `UPDATE orders SET order_status = 'work_completed', work_completed_at = now() WHERE id = $1`,
    [orderId],
  );
}

// ===================== السيناريوهات =====================

/** S1 — نفس المفتاح، N نداء متزامن. */
async function scenarioS1(ctx) {
  const customer = await makeCustomer(ctx.city.id, 's1');
  await fundWallet(customer.userId, PRICE_CENTS);
  const order = await createOrder(customer, ctx.service.id);
  await driveToPayable(order.id);

  const key = `s1-${runId}`;
  const N = 10;
  const responses = await Promise.all(
    Array.from({ length: N }, () =>
      api(`/orders/${order.id}/pay-with-wallet`, {
        method: 'POST',
        token: customer.token,
        headers: { 'idempotency-key': key },
      }),
    ),
  );

  const codes = {};
  for (const r of responses) codes[r.status] = (codes[r.status] ?? 0) + 1;
  const paymentIds = new Set(responses.map((r) => r.body?.data?.id).filter(Boolean));
  const rows = await q(
    `SELECT id, payment_status, amount_cents FROM payments WHERE order_id = $1`,
    [order.id],
  );
  const wallet = await walletOf(customer.userId);
  const debits = await q(
    `SELECT COALESCE(SUM(amount_cents),0)::int AS total FROM wallet_transactions
      WHERE wallet_id = $1 AND direction = 'debit'`,
    [wallet.id],
  );

  const ok =
    rows.length === 1 &&
    paymentIds.size <= 1 &&
    wallet.balance_cents === 0 &&
    debits[0].total === PRICE_CENTS &&
    !responses.some((r) => r.status >= 500);
  record(
    'S1 نفس Idempotency-Key ×10 متزامن',
    ok,
    `أكواد=${JSON.stringify(codes)} دفعات=${rows.length} معرّفات مميزة=${paymentIds.size} ` +
      `رصيد=${wallet.balance_cents} مخصوم=${debits[0].total} (المتوقع دفعة واحدة، رصيد 0، مخصوم ${PRICE_CENTS})`,
  );
}

/** S2 — نفس الطلب بمفاتيح مختلفة متزامنة (نقر متكرر بعد فشل شبكة). */
async function scenarioS2(ctx) {
  const customer = await makeCustomer(ctx.city.id, 's2');
  await fundWallet(customer.userId, PRICE_CENTS * 10);
  const order = await createOrder(customer, ctx.service.id);
  await driveToPayable(order.id);

  const N = 10;
  const responses = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      api(`/orders/${order.id}/pay-with-wallet`, {
        method: 'POST',
        token: customer.token,
        headers: { 'idempotency-key': `s2-${runId}-${i}` },
      }),
    ),
  );

  const codes = {};
  for (const r of responses) codes[r.status] = (codes[r.status] ?? 0) + 1;
  const succeeded = await q(
    `SELECT count(*)::int AS n FROM payments WHERE order_id = $1 AND payment_status = 'succeeded'`,
    [order.id],
  );
  const wallet = await walletOf(customer.userId);
  const expectedBalance = PRICE_CENTS * 10 - PRICE_CENTS;

  const ok =
    succeeded[0].n === 1 &&
    wallet.balance_cents === expectedBalance &&
    !responses.some((r) => r.status >= 500);
  record(
    'S2 نفس الطلب ×10 مفاتيح مختلفة',
    ok,
    `أكواد=${JSON.stringify(codes)} دفعات ناجحة=${succeeded[0].n} رصيد=${wallet.balance_cents} ` +
      `(المتوقع 1 و ${expectedBalance})`,
  );
}

/** S3 — رصيد يكفي طلب واحد بس، طلبين متزامنين على نفس المحفظة. */
async function scenarioS3(ctx) {
  const customer = await makeCustomer(ctx.city.id, 's3');
  await fundWallet(customer.userId, PRICE_CENTS);
  const orderA = await createOrder(customer, ctx.service.id);
  const orderB = await createOrder(customer, ctx.service.id);
  await driveToPayable(orderA.id);
  await driveToPayable(orderB.id);

  const responses = await Promise.all([
    api(`/orders/${orderA.id}/pay-with-wallet`, {
      method: 'POST',
      token: customer.token,
      headers: { 'idempotency-key': `s3a-${runId}` },
    }),
    api(`/orders/${orderB.id}/pay-with-wallet`, {
      method: 'POST',
      token: customer.token,
      headers: { 'idempotency-key': `s3b-${runId}` },
    }),
  ]);

  const codes = responses.map((r) => r.status);
  const succeeded = await q(
    `SELECT count(*)::int AS n FROM payments WHERE order_id = ANY($1::uuid[]) AND payment_status = 'succeeded'`,
    [[orderA.id, orderB.id]],
  );
  const wallet = await walletOf(customer.userId);

  const ok =
    succeeded[0].n === 1 &&
    wallet.balance_cents === 0 &&
    codes.filter((c) => c >= 500).length === 0;
  record(
    'S3 رصيد لطلب واحد وطلبين متزامنين',
    ok,
    `أكواد=${JSON.stringify(codes)} دفعات ناجحة=${succeeded[0].n} رصيد=${wallet.balance_cents} ` +
      `(المتوقع 1 و 0 — ومفيش رصيد سالب)`,
  );
}

/** حمولة Paymob كاملة + توقيع HMAC صحيح لنفس السر الوهمي المزروع. */
function paymobPayload(paymentId, amountCents, txId) {
  const obj = {
    id: txId,
    amount_cents: amountCents,
    created_at: '2026-09-09T10:00:00.000000',
    currency: 'EGP',
    error_occured: false,
    has_parent_transaction: false,
    integration_id: 1234,
    is_3d_secure: true,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    order: { id: 987654, merchant_order_id: paymentId },
    owner: 111,
    pending: false,
    source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
    success: true,
  };
  const fields = [
    String(obj.amount_cents), obj.created_at, obj.currency, String(obj.error_occured),
    String(obj.has_parent_transaction), String(obj.id), String(obj.integration_id),
    String(obj.is_3d_secure), String(obj.is_auth), String(obj.is_capture), String(obj.is_refunded),
    String(obj.is_standalone_payment), String(obj.is_voided), String(obj.order.id), String(obj.owner),
    String(obj.pending), obj.source_data.pan, obj.source_data.sub_type, obj.source_data.type,
    String(obj.success),
  ].join('');
  const hmac = crypto.createHmac('sha512', PAYMOB_TEST_HMAC).update(fields).digest('hex');
  return { body: { type: 'TRANSACTION', obj }, hmac };
}

/** S4 — البوابة بعتت نفس الحدث ٥ مرات متزامنة + ٥ تتابعية. */
async function scenarioS4(ctx) {
  const customer = await makeCustomer(ctx.city.id, 's4');
  const order = await createOrder(customer, ctx.service.id, { prepayment_method: 'card' });

  // الدفعة نفسها: بنسجّلها مباشرةً بحالة PENDING زي ما `payWithCard` بيعمل بالظبط — من غير
  // نداء حقيقي لـPaymob (مفيش شبكة خارجية، والنداء ده مش اللي بنقيسه أصلاً).
  const [payment] = await q(
    `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method,
        payment_gateway, payment_status, idempotency_key)
     VALUES (next_human_readable_number('PAY'), $1, $2, $3, 'card', 'paymob', 'pending', $4)
     RETURNING id, amount_cents`,
    [order.id, customer.profileId, order.total_amount_cents ?? PRICE_CENTS, `s4-${runId}`],
  );

  const { body, hmac } = paymobPayload(payment.id, payment.amount_cents, 555_000 + (Date.now() % 1000));
  const post = () =>
    api(`/webhooks/paymob?hmac=${hmac}`, { method: 'POST', body });

  const concurrent = await Promise.all(Array.from({ length: 5 }, post));
  const sequential = [];
  for (let i = 0; i < 5; i++) sequential.push(await post());
  const all = [...concurrent, ...sequential];

  const codes = {};
  for (const r of all) codes[r.status] = (codes[r.status] ?? 0) + 1;

  const [pay] = await q(`SELECT payment_status FROM payments WHERE id = $1`, [payment.id]);
  const succeededCount = await q(
    `SELECT count(*)::int AS n FROM payments WHERE order_id = $1 AND payment_status = 'succeeded'`,
    [order.id],
  );
  const events = await q(
    `SELECT count(*)::int AS n, max(retry_count)::int AS retries, max(processing_status::text) AS status
       FROM webhook_events WHERE external_event_id = $1`,
    [String(body.obj.id)],
  );
  // أرباح الفني بتتسجّل في `order_earning_shares` (حصة لكل مشارك) — الفهرس الفريد على
  // (order_id, technician_id) هو اللي بيخلي إعادة التسوية بلا أثر مكرر، فتكرار الصفوف هنا
  // هو الكاشف المباشر لتسوية اتعملت أكتر من مرة.
  const earnings = await q(
    `SELECT count(*)::int AS n FROM order_earning_shares WHERE order_id = $1`,
    [order.id],
  );
  const statusHistory = await q(
    `SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1 AND new_status = 'searching_technician'`,
    [order.id],
  );

  const ok =
    pay.payment_status === 'succeeded' &&
    succeededCount[0].n === 1 &&
    events[0].n === 1 &&
    earnings[0].n <= 1 &&
    !all.some((r) => r.status >= 500);
  record(
    'S4 webhook مكرر ×10 (5 متزامن + 5 تتابعي)',
    ok,
    `أكواد=${JSON.stringify(codes)} حالة الدفعة=${pay.payment_status} دفعات ناجحة=${succeededCount[0].n} ` +
      `صفوف webhook_events=${events[0].n} (retry=${events[0].retries}, ${events[0].status}) ` +
      `أرباح فني=${earnings[0].n} انتقالات توزيع=${statusHistory[0].n}`,
  );
  return { order, payment, customer };
}

/** S5 — أدمن ضغط «استرداد» مرتين في نفس اللحظة. */
async function scenarioS5(ctx) {
  const customer = await makeCustomer(ctx.city.id, 's5');
  await fundWallet(customer.userId, PRICE_CENTS);
  const order = await createOrder(customer, ctx.service.id);
  await driveToPayable(order.id);
  const pay = await api(`/orders/${order.id}/pay-with-wallet`, {
    method: 'POST',
    token: customer.token,
    headers: { 'idempotency-key': `s5-${runId}` },
  });
  if (pay.status !== 201 && pay.status !== 200) {
    record('S5 استرداد مزدوج متزامن', false, `الدفع الأولي فشل: ${pay.status} ${JSON.stringify(pay.body).slice(0, 200)}`);
    return;
  }

  const walletBefore = await walletOf(customer.userId);
  const tokens = [await stepUpToken(ctx.admin.userId), await stepUpToken(ctx.admin.userId)];
  const responses = await Promise.all(
    tokens.map((t) =>
      api(`/admin/orders/${order.id}/refund`, {
        method: 'POST',
        token: ctx.admin.token,
        headers: { 'x-step-up-token': t },
        body: { reason_notes: 'اختبار استرداد مزدوج متزامن' },
      }),
    ),
  );

  const codes = responses.map((r) => r.status);
  const refunds = await q(
    `SELECT refund_status, amount_cents FROM refunds WHERE order_id = $1`,
    [order.id],
  );
  const completed = refunds.filter((r) => r.refund_status === 'completed');
  const walletAfter = await walletOf(customer.userId);
  const credited = walletAfter.balance_cents - walletBefore.balance_cents;

  const ok =
    completed.length === 1 &&
    credited === PRICE_CENTS &&
    !responses.some((r) => r.status >= 500);
  record(
    'S5 استرداد مزدوج متزامن',
    ok,
    `أكواد=${JSON.stringify(codes)} استردادات=${refunds.length} (مكتملة ${completed.length}) ` +
    `${ok ? '' : `ردّ=${JSON.stringify(responses[0].body?.error ?? responses[0].body).slice(0, 200)} `}` +
      `اترد للعميل=${credited} (المتوقع استرداد واحد و ${PRICE_CENTS})`,
  );
  return { order, customer };
}

/** S6 — إلغاء طلب بعد الدفع: الحسابات لازم تقفل. */
async function scenarioS6(ctx) {
  const customer = await makeCustomer(ctx.city.id, 's6');
  await fundWallet(customer.userId, PRICE_CENTS);
  const order = await createOrder(customer, ctx.service.id);
  await driveToPayable(order.id);
  await api(`/orders/${order.id}/pay-with-wallet`, {
    method: 'POST',
    token: customer.token,
    headers: { 'idempotency-key': `s6-${runId}` },
  });

  const walletBefore = await walletOf(customer.userId);
  const token = await stepUpToken(ctx.admin.userId);
  const refund = await api(`/admin/orders/${order.id}/refund`, {
    method: 'POST',
    token: ctx.admin.token,
    headers: { 'x-step-up-token': token },
    body: { reason_notes: 'إلغاء بعد الدفع', amount_cents: Math.floor(PRICE_CENTS * 0.8) },
  });

  const walletAfter = await walletOf(customer.userId);
  const credited = walletAfter.balance_cents - walletBefore.balance_cents;
  const [orderRow] = await q(`SELECT payment_status, order_status FROM orders WHERE id = $1`, [order.id]);
  const [sum] = await q(
    `SELECT COALESCE(SUM(amount_cents),0)::int AS total FROM refunds
      WHERE order_id = $1 AND refund_status = 'completed'`,
    [order.id],
  );

  const expected = Math.floor(PRICE_CENTS * 0.8);
  const ok = refund.status < 400 && credited === expected && sum.total === expected;
  record(
    'S6 استرداد جزئي بعد الدفع (إلغاء برسم)',
    ok,
    `كود=${refund.status} اترد=${credited} مجموع الاستردادات=${sum.total} (المتوقع ${expected}) ` +
    `${ok ? '' : `ردّ=${JSON.stringify(refund.body?.error ?? refund.body).slice(0, 200)} `}` +
      `حالة الطلب=${orderRow.order_status}/${orderRow.payment_status}`,
  );
}

// ===================== إعداد بوابة الاختبار =====================

async function readSettings(keys) {
  const rows = await q(`SELECT key, value::text AS value FROM settings WHERE key = ANY($1)`, [keys]);
  return new Map(rows.map((r) => [r.key, r.value]));
}

const PAYMOB_KEYS = [
  'payments.paymob.api_key',
  'payments.paymob.secret_key',
  'payments.paymob.public_key',
  'payments.paymob.integration_id_card',
  'payments.paymob.hmac_secret',
];

/**
 * الأسرار بتتخزّن مشفّرة عادةً، لكن `decryptSecret()` بتقبل نص خام صراحةً (توافق bootstrap من
 * البيئة/الـmigration) — فبنكتب نص خام هنا بدل ما نحتاج مفتاح تشفير التطبيق. إعادة التشغيل
 * ضرورية لأن الـprovider بيقرا إعداده في `onModuleInit` وبيتحدّث بحدث داخلي مش بكتابة SQL.
 */
async function enableTestGateway() {
  const before = await readSettings(PAYMOB_KEYS);
  const values = {
    'payments.paymob.api_key': 'test-api-key',
    'payments.paymob.secret_key': 'test-secret-key',
    'payments.paymob.public_key': 'test-public-key',
    'payments.paymob.integration_id_card': '1234',
    'payments.paymob.hmac_secret': PAYMOB_TEST_HMAC,
  };
  for (const [key, value] of Object.entries(values)) {
    await q(`UPDATE settings SET value = $2::jsonb WHERE key = $1`, [key, JSON.stringify(value)]);
  }
  await invalidateSettingsCache(PAYMOB_KEYS);
  await restartApi();
  return before;
}

/**
 * الكتابة بـSQL بتعدّي على `SettingsService.update()`، وde الطبقة اللي بتبطّل كاش Redis. من
 * غير الإبطال ده الـAPI بيقرا القيمة القديمة من Redis وقت الإقلاع مهما كان الصف في القاعدة —
 * وده كان بيخلي سيناريو الـwebhook يقيس بوابة «مش مُعدّة» ويعدّي كأن مفيش حدث أصلاً.
 */
async function invalidateSettingsCache(keys) {
  const url = process.env.REDIS_URL ?? ENV.REDIS_URL ?? 'redis://localhost:6379';
  const Redis = require('/home/user/portalSp/node_modules/ioredis');
  const redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    await redis.del(...keys.map((key) => `settings:${key}`));
  } finally {
    redis.disconnect();
  }
}

async function restoreGateway(before) {
  for (const key of PAYMOB_KEYS) {
    const value = before.get(key) ?? '""';
    await q(`UPDATE settings SET value = $2::jsonb WHERE key = $1`, [key, value]);
  }
  await invalidateSettingsCache(PAYMOB_KEYS);
  await restartApi();
}

/**
 * إعادة تشغيل الـAPI **من نود مباشرةً، مش عبر `scripts/dev-api.sh`**.
 *
 * `execFileSync('bash', ['dev-api.sh','restart'], {stdio:'pipe'})` بيعلّق: السكريبت بيسيب
 * السيرفر شغّال في الخلفية، و`execFileSync` بيفضل مستني أنابيب stdout/stderr تتقفل — وهي
 * مش بتتقفل طول ما فيه سليل شغّال. `spawn` منفصل (`detached` + `stdio:'ignore'`) + انتظار
 * الجاهزية بـ`fetch` بيدي نفس النتيجة بلا الاعتماد على قشرة وسيطة.
 */
async function restartApi() {
  try {
    execFileSync('pkill', ['-9', '-f', 'node ./dist/main.js'], { stdio: 'ignore' });
  } catch {
    /* مفيش نسخة شغّالة — مش خطأ */
  }
  for (let i = 0; i < 20 && (await isApiUp()); i++) await new Promise((r) => setTimeout(r, 500));

  const apiDir = path.join(ROOT, 'apps/api');
  fs.mkdirSync(path.join(apiDir, '.dev-logs'), { recursive: true });
  const log = fs.openSync(path.join(apiDir, '.dev-logs/api.out'), 'a');
  spawn(process.execPath, ['./dist/main.js'], {
    cwd: apiDir,
    detached: true,
    stdio: ['ignore', log, log],
  }).unref();

  for (let i = 0; i < 90; i++) {
    if (await isApiUp()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('الـAPI مابقاش بيرد بعد إعادة التشغيل');
}

async function isApiUp() {
  try {
    const res = await fetch(`${API}/branding`);
    return res.status === 200;
  } catch {
    return false;
  }
}

// ===================== التشغيل =====================

async function run() {
  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  console.log(`\n=== ج-٢: idempotency مالي كامل — تشغيلة ${runId} ===\n`);
  const [{ now: startedAt }] = await q(`SELECT now() AS now`);

  const ctx = await seedCatalog();
  ctx.admin = await makeAdmin();

  let gatewayBefore = null;
  try {
    if (wanted('S1')) await scenarioS1(ctx);
    if (wanted('S2')) await scenarioS2(ctx);
    if (wanted('S3')) await scenarioS3(ctx);
    if (wanted('S4')) {
      gatewayBefore = await enableTestGateway();
      await scenarioS4(ctx);
    }
    if (wanted('S5')) await scenarioS5(ctx);
    if (wanted('S6')) await scenarioS6(ctx);
  } finally {
    if (gatewayBefore) await restoreGateway(gatewayBefore);
  }

  // ===== الثوابت الحاكمة بعد كل السيناريوهات =====
  const ledger = await ledgerImbalance(startedAt);
  record(
    'الدفتر متوازن (مجموع قيود التشغيلة = صفر)',
    ledger.net === 0,
    `قيود اتكتبت=${ledger.rows} صافي=${ledger.net}`,
  );
  const negatives = await negativeBalances(created.users);
  record(
    'مفيش محفظة عميل/فني برصيد سالب',
    negatives.length === 0,
    negatives.length ? JSON.stringify(negatives) : `فُحص ${created.users.length} مستخدم`,
  );

  console.log(`\n--- الخلاصة ---`);
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} نجحوا`);
  if (findings.length) {
    console.log(`\n❌ نتائج تحتاج تدخّل:`);
    for (const f of findings) console.log(`   • ${f}`);
  }

  if (!KEEP) {
    console.log(`\nتنظيف...`);
    for (const serviceId of created.serviceIds) {
      execFileSync(process.execPath, [path.join(ROOT, 'scripts/clean-test-data.js'), '--service', serviceId], {
        env: { ...process.env, DATABASE_URL },
        stdio: 'pipe',
      });
    }
    await cascadeDelete('technician_profiles', [ctx.tech.id]);
    // أدمن الاختبار بيكتب سجلات تدقيق (append-only) فمش هينحذف — بنكمّل بدل ما نفشل التنظيف كله.
    try {
      await cascadeDelete('users', created.users);
    } catch (err) {
      console.log(`تنبيه: مستخدمين مش قابلين للحذف (سجل تدقيق مرتبط): ${err instanceof Error ? err.message : err}`);
    }
    await q(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [created.serviceIds]);
    await q(`DELETE FROM service_zones WHERE id = ANY($1::uuid[])`, [created.zoneIds]);
    await q(`DELETE FROM service_categories WHERE id = ANY($1::uuid[])`, [created.categoryIds]);
    await q(`DELETE FROM cities WHERE id = ANY($1::uuid[])`, [created.cityIds]);
  } else {
    console.log(`\n--keep: البيانات سايبها`);
  }

  await db.end();
  process.exit(failed.length ? 1 : 0);
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
