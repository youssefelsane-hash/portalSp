/**
 * **أساس مشترك لكل تدقيق حي على المكدس الكامل** (HTTP → NestJS → Postgres/Redis).
 *
 * الاحتكاك اللي بيحلّه: كل تدقيق جديد (ج-١ الحجز، ج-٢ الفلوس، ج-٣ آلة الحالة، …) كان بيعيد
 * كتابة نفس التلاتمية سطر: تحميل `.env`، توقيع JWT محليًا، بذر كتالوج/فني/عميل/أدمن، حذف
 * تعاقبي من `pg_constraint`، وثوابت الدفتر. النسخ ده مش بس إهدار — هو كمان بيخلي إصلاح
 * اتعمل في تدقيق (زي حذف `refunds` قبل `payments`) ما يوصلش للتدقيق اللي بعده.
 *
 * الملف ده **مايعرفش أي شيء عن سيناريو بعينه** — كل تدقيق بيبني سيناريوهاته فوقه.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
// Resolve through Node's normal module lookup. The old absolute `/home/user/portalSp` path
// only existed in one development machine, so every local financial audit failed elsewhere.
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { PIN_BCRYPT_ROUNDS } = require('./pin-constants');

const ROOT = path.resolve(__dirname, '../..');
const API = process.env.API_BASE_URL ?? 'http://localhost:3000/api/v1';
const { deleteOrdersWhere } = require('./delete-orders-safely');

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

/**
 * **رمز الدخول الموحّد لكل السكربتات الحية** (ADR-0109).
 *
 * مش متسلسل ومش كله نفس الرقم عشان يعدّي `isWeakPin` في الباك-إند. لازم يطابق `DEV_SEED_PIN`
 * في سكربتات الـseed و`kLiveTestPin` في `test_live/` بتاع التطبيقين. مش سر: بيتحط على حسابات
 * وهمية في قاعدة تطوير محلية.
 */
const LIVE_TEST_PIN = process.env.DEV_SEED_PIN || '417253';

/**
 * **هاش الرمز، محسوب مرة واحدة لكل عملية.** كل المستخدمين اللي الهارنس بيعملهم بياخدوا نفس
 * الرمز، وتكلفة bcrypt ١٢ مضروبة في عدد المستخدمين كانت بتضيف ثواني حقيقية على كل تشغيلة.
 *
 * **ليه المستخدمين المُدخلين مباشرةً محتاجين رمز أصلاً؟** لأن أدوات زي `verify-web-flow-order`
 * و`sweep-customer` بتعمل المستخدم بالـSQL وبعدين **بتسجّل دخول بالمتصفح** بيه. من غير رمز
 * شاشة الدخول بترفضه، والأداة بتفشل لسبب مالوش أي علاقة باللي بتقيسه.
 */
let cachedPinHash = null;
function livePinHash() {
  cachedPinHash ??= bcrypt.hashSync(LIVE_TEST_PIN, PIN_BCRYPT_ROUNDS);
  return cachedPinHash;
}

class LiveHarness {
  /** `prefix` بيميّز بيانات التدقيق ده عن غيره في التنظيف (مثلاً `sm` لآلة الحالة). */
  constructor(prefix) {
    this.prefix = prefix;
    this.runId = Date.now().toString(36);
    this.runNum = String(Date.now() % 100000).padStart(5, '0');
    this.phoneSeq = 0;
    this.tagSeq = 0;
    this.dayCursor = 5;
    this.created = { users: [], serviceIds: [], zoneIds: [], cityIds: [], categoryIds: [], roles: [] };
    this.results = [];
    this.db = null;
  }

  async connect() {
    this.db = new Client({ connectionString: DATABASE_URL });
    await this.db.connect();
    const [{ now }] = await this.q(`SELECT now() AS now`);
    this.startedAt = now;
  }

  async close() {
    try {
      await this.db?.end();
    } catch {
      /* الإغلاق مش مهم لو الاتصال اتقطع أصلاً */
    }
    // **ليه بنقفل موزّع `fetch` كمان** (تدقيق شامل 2026-09-20): `fetch` العالمي في Node
    // بيسيب اتصالات keep-alive مفتوحة في pool، وده لوحده بيمنع الـprocess من الخروج حتى بعد ما
    // التدقيق يطبع نتيجته. `booking-suggestion-audit` اتلقط فعليًا وهو بيطبع «24/24 فحص نضيف 🟢»
    // وبعدين يفضل معلّق ٨ دقايق لحد ما الـ`timeout` يقتله — يعني في CI تشغيلة خضرا ١٠٠٪ بتبان
    // كـtimeout failure. الإغلاق هنا في المكان المشترك فيوصل لكل تدقيق بيستخدم الهارنس.
    try {
      await globalThis[Symbol.for('undici.globalDispatcher.1')]?.close?.();
    } catch {
      /* نسخة Node من غير الرمز ده — مفيش حاجة تتقفل، والخروج بيتم عادي */
    }
  }

  async q(sql, params) {
    return (await this.db.query(sql, params)).rows;
  }

  /**
   * حذف طلبات بترتيب آمن للمفاتيح الأجنبية — للتنظيف بعد التدقيق.
   *
   * كل تدقيق كان بيكتب `DELETE FROM orders WHERE …` بإيده، وده بيفشل أول ما جدول جديد يشاور
   * على `orders` (حصل فعلاً: `chat_threads_order_id_fkey` في `booking-suggestion-audit`).
   * والفشل هنا صامت عمليًا: التدقيق بيكون خلص وطبع نتيجته خلاص، فالبقايا بتفضل وتكسر
   * التشغيلة اللي بعدها. (تدقيق §148، المرحلة ٩)
   *
   *   await h.deleteOrders(`order_number LIKE $1`, ['BSG-%']);
   */
  async deleteOrders(whereSql, params = []) {
    return deleteOrdersWhere(this.db, whereSql, params);
  }

  record(name, ok, detail) {
    this.results.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`);
    return ok;
  }

  get failures() {
    return this.results.filter((r) => !r.ok);
  }

  // ===================== HTTP =====================

  /**
   * `timeoutMs` مهم في تدقيقات الانقطاع: من غيره، نداء بيعلّق بيرمي `fetch failed` ويوقّع
   * التدقيق كله بدل ما يتسجّل كقياس. مع المهلة، التعليق بيرجع `{ status: 0, timedOut: true }`
   * فالتقرير بيقول «عدّى س ثانية» بدل ما ينهار.
   */
  async api(pathname, { method = 'GET', token, body, headers = {}, timeoutMs } = {}) {
    const controller = timeoutMs ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetch(`${API}${pathname}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller?.signal,
      });
    } catch (err) {
      return { status: 0, timedOut: true, body: { error: { message: String(err?.message ?? err) } } };
    } finally {
      if (timer) clearTimeout(timer);
    }
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text.slice(0, 400) };
    }
    return { status: res.status, body: parsed };
  }

  /**
   * رفع صورة «بعد الشغل» — شرط إجباري قبل `complete`. المسار multipart بملف حقيقي، والباك-إند
   * بيفحص **بصمة الملف** (magic bytes) مش الامتداد، فالبايتات دي لازم تكون PNG صحيحة فعلاً.
   */
  async uploadAfterPhoto(orderId, technicianToken) {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const form = new FormData();
    form.append('media_type', 'after_photo');
    form.append('file', new Blob([png], { type: 'image/png' }), 'after.png');
    const res = await fetch(`${API}/technician/orders/${orderId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${technicianToken}` },
      body: form,
    });
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text.slice(0, 300) };
    }
    return { status: res.status, body: parsed };
  }

  /**
   * توقيع التوكن محليًا بدل دورة دخول كاملة لكل مستخدم — ده بيختصر الإعداد بس، الطلب نفسه
   * بيعدّي على كل الحُرّاس زي أي مستخدم حقيقي.
   */
  token(userId, userType = 'customer') {
    return jwt.sign({ sub: userId, userType, amr: ['pin'] }, JWT_SECRET, { expiresIn: '60m' });
  }

  /**
   * **تسجيل عميل بالمسار الحقيقي** (`POST /auth/pin/register`) — مصدر واحد لكل السكربتات.
   *
   * ### إيه اللي اتشال هنا (ADR-0109)
   *
   * كل سكربت كان بينسخ نفس التسع خطوات بالإيد: اطلب OTP → استنى ٤٠٠ مللي → حلّ مسار لوج
   * الباك-إند → اقراه كله → دوّر على `[OTP] <رقم> … → <كود>` بـregex → لو ملقيتوش اطلع بخطأ →
   * سجّل. أربع نقاط فشل مالهاش أي علاقة بالحاجة المقيسة، **في تسع ملفات**. دلوقتي نداء واحد
   * بلا لوج وبلا انتظار.
   *
   * `extra` بيتدمج في الجسم زي ما هو، فأي حقل إسناد (`marketing_code`، `referral_code`،
   * `promo_link_code`، `technician_referral_code`) بيتبعت **بنفس المسار الحقيقي** — وده كان
   * جوهر الفحوص دي أصلاً: إدخال صف `users` مباشرةً بيتخطّى الـDTO والأحداث اللي بعده.
   *
   * بيرجّع `{ userId, token, phone }` أو `{ error }` — نفس شكل الرد اللي السكربتات متوقعاه.
   */
  async registerCustomerWithPin({ fullName, phone = this.nextPhone(), ...extra } = {}) {
    const res = await this.api('/auth/pin/register', {
      method: 'POST',
      body: {
        phone_number: phone,
        pin: LIVE_TEST_PIN,
        full_name: fullName ?? `عميل اختبار ${this.nextTag()}`,
        user_type: 'customer',
        ...extra,
      },
    });
    if (res.status !== 201 && res.status !== 200) {
      const message = res.body?.error?.message ?? res.body?.message ?? '';
      return { error: `HTTP=${res.status} ${message}`, phone };
    }
    const [row] = await this.q(`SELECT id FROM users WHERE phone_number = $1`, [phone]);
    if (row) this.created.users.push(row.id);
    return { userId: row?.id, token: row ? this.token(row.id) : null, phone };
  }

  /** دخول برمز لحساب موجود — بيرجّع `{ accessToken }` أو `{ error }`. */
  async loginWithPin(phone, pin = LIVE_TEST_PIN) {
    const res = await this.api('/auth/pin/login', {
      method: 'POST',
      body: { phone_number: phone, pin },
    });
    if (res.status !== 200 && res.status !== 201) {
      const message = res.body?.error?.message ?? res.body?.message ?? '';
      return { error: `HTTP=${res.status} ${message}` };
    }
    return { accessToken: res.body?.data?.access_token };
  }

  nextPhone() {
    return `+2010${this.runNum}${String(this.phoneSeq++).padStart(3, '0')}`;
  }

  /**
   * لاصقة فريدة **لكل نداء** داخل نفس التشغيلة. `runId` وحده مش كفاية: تدقيق زي ج-٤ بيبذر
   * كتالوج معزول لكل حالة، والـslugs المشتقة من `runId` بس بتصطدم بـ`cities_slug_key`.
   */
  nextTag() {
    return `${this.runId}${(this.tagSeq++).toString(36)}`;
  }

  /**
   * كل طلب اختبار بياخد يوم لوحده: السقف اليومي للفني (`matching.daily_capacity_minutes`)
   * مشترك، فطلبات سيناريوهات مختلفة على نفس اليوم بتتزاحم عليه — والرفض الصحيح من محرك
   * المطابقة بيبان كأنه عطل توزيع.
   */
  nextDay() {
    const d = new Date(Date.now() + this.dayCursor++ * 86_400_000);
    return `${d.toISOString().slice(0, 10)}T09:00:00.000Z`;
  }

  // ===================== حذف تعاقبي =====================

  /**
   * حذف صف أب مع كل اللي بيشاور عليه بالتعمّق — من `pg_constraint` مش من قايمة مكتوبة بالإيد.
   * (`wallet_transactions → wallets → users` و`refunds → payments` الاتنين اتلقطوا بالطريقة
   * الصعبة في تدقيقات سابقة.)
   *
   * ## العمود اللي بيقبل NULL بيتفضّى، ما بيتحذفش (بَقّة حقيقية بضرر واقع فعلاً)
   *
   * النسخة الأولى كانت بتحذف **أي** صف بيشاور على الأب. المشكلة إن كتير من الأعمدة دي مش
   * «ملكية» — دي **بصمة مين عمل الحاجة** (`settings.updated_by_user_id`،
   * `orders.cancelled_by_user_id`، `complaints.resolved_by_user_id`، `earnings_skill_policy.
   * updated_by_user_id` وأكتر من ٢٠ غيرهم). فحذف أدمن الاختبار كان بيمسح **صفوف عامة مملوكة
   * للنظام** لمجرد إن الأدمن ده آخر واحد لمسها.
   *
   * **الضرر مش نظري — اتقاس**: تدقيق ج-٧ عدّل `ops.alert_stuck_searching_minutes` من مسار
   * الأدمن، وتنظيفه بعد كده **مسح الصف من القاعدة نهائيًا**. ونفس الحاجة حصلت لمفتاحي إيقاف
   * الحجز في أول تشغيلة لتدقيق ج-١٧. النتيجة كانت `PATCH → 404 الإعداد غير موجود` — يعني
   * «مفتاح الطوارئ اختفى» من غير أي رسالة خطأ وقت الحذف.
   *
   * القاعدة الصح مشتقّة من الـschema نفسه مش من قايمة استثناءات: عمود FK **بيقبل NULL** معناه
   * «علاقة اختيارية»، فقطعها هو التنظيف السليم. عمود **NOT NULL** معناه إن الابن ما ينفعش يعيش
   * من غير الأب، فالحذف هو السليم.
   *
   * ## و«بيقبل NULL» **مش دايمًا** معناه اختياري — الفشل بيقرّر، مش التخمين
   *
   * `booking_match_previews.technician_id` بيقبل NULL في تعريف العمود، لكن
   * `chk_booking_match_preview_provider` بيفرض إن **واحد** من (فني، شركة) يبقى موجود. يعني
   * العمود ملكية حقيقية، والـ`NULL` مسموح بس عشان البديل. الـ`UPDATE … SET NULL` كان بيترفض،
   * والـ`.catch(() => {})` كان **بيبلع الرفض بصمت**، فالحذف بعده يقع على FK برسالة مالهاش
   * علاقة بالسبب (بالظبط زي ما حصل في تدقيق الفنل).
   *
   * فالتصنيف بقى بالمحاولة مش بالتخمين: نجرّب نقطع العلاقة، ولو القاعدة رفضت يبقى الصف مملوك
   * فعلاً ⇒ نحذفه بنفس مسار العمود الإجباري. مفيش أي فشل بيتبلع.
   */
  /**
   * حذف حركات محفظة **مع إرجاع أثرها على أرصدة المحافظ المتأثرة**.
   *
   * نفس بَقّة تنظيف السبيكات بالحرف (`apps/api/src/modules/payments/wallet-cleanup.testing.ts`):
   * كل تسوية بتكتب قيد مزدوج، طرف على محفظة الفني وطرف على **محفظة المنصة المشتركة**. الحذف
   * التعاقبي بيشيل الصفوف، بس `wallets.balance_cents` بيفضل شايل أثرها — ومحفظة المنصة
   * مابتتمسحش أبدًا، فكل تشغيلة تدقيق كانت بتزوّد الانحراف.
   *
   * اتقاس فعلاً: تشغيلة تدقيقات واحدة بعد إصلاح السبيكات رجّعت العدّاد من ٠ لـ١ بفرق
   * ١٤٦٠ ج.م. يعني الإصلاح في السبيكات وحده ماكانش هيكفي طول ما التدقيقات الحية بتنضّف بالطريقة
   * القديمة.
   */
  async deleteWalletTransactions(whereSql, params) {
    const affected = await this.q(
      `WITH deleted AS (
         DELETE FROM wallet_transactions WHERE ${whereSql}
         RETURNING wallet_id, balance_after_cents - balance_before_cents AS effect_cents
       ), per_wallet AS (
         SELECT wallet_id, SUM(effect_cents)::bigint AS effect_cents FROM deleted GROUP BY wallet_id
       ), restored AS (
         UPDATE wallets w SET balance_cents = w.balance_cents - p.effect_cents
           FROM per_wallet p WHERE w.id = p.wallet_id
         RETURNING w.id AS wallet_id
       )
       SELECT wallet_id FROM restored`,
      params,
    );
    if (!affected.length) return;

    // عبارة تانية عمدًا: تعديلات CTE مش مرئية لباقي أجزاء نفس العبارة في Postgres، فالحياكة
    // جوّه العبارة فوق كانت هتحسب المجاميع وهي لسه شايفة الصفوف المحذوفة.
    await this.q(
      `UPDATE wallet_transactions t
          SET balance_before_cents = c.before_cents, balance_after_cents = c.after_cents
         FROM (
           SELECT x.id,
                  COALESCE(SUM(x.effect) OVER (
                    PARTITION BY x.wallet_id ORDER BY x.created_at, x.id
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::int AS before_cents,
                  SUM(x.effect) OVER (PARTITION BY x.wallet_id ORDER BY x.created_at, x.id)::int AS after_cents
             FROM (
               SELECT id, wallet_id, created_at,
                      CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END AS effect
                 FROM wallet_transactions WHERE wallet_id = ANY($1::uuid[])
             ) x
         ) c
        WHERE t.id = c.id
          AND (t.balance_before_cents <> c.before_cents OR t.balance_after_cents <> c.after_cents)`,
      [affected.map((row) => row.wallet_id)],
    );
  }

  async cascadeDelete(table, ids, depth = 0) {
    if (!ids.length || depth > 4) return;
    // حركات المحافظ ليها مسار حذف خاص بيرجّع الأرصدة — لو اتمسحت كصفوف عادية هنا، الطرف
    // المقابل على محفظة المنصة بيفضل محسوب في رصيدها وهي مابتتمسحش أبدًا.
    if (table === 'wallet_transactions') {
      await this.deleteWalletTransactions(`id = ANY($1::uuid[])`, [ids]);
      return;
    }
    const refs = await this.q(
      `SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name, a.attnotnull AS required
         FROM pg_constraint c
         JOIN unnest(c.conkey) k(attnum) ON true
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.contype = 'f' AND c.confrelid = $1::regclass AND c.confdeltype = 'a'`,
      [table],
    );
    for (const ref of refs) {
      if (ref.table_name === table) continue; // مراجع ذاتية بتتحل بحذف الصف نفسه
      // `audit_logs` append-only بقرار معماري (trigger بيرفض DELETE) — مستخدم كتب سجل تدقيق
      // مش هينحذف، وده مقصود مش عطل تنظيف.
      if (ref.table_name === 'audit_logs') continue;
      if (!ref.required) {
        // علاقة اختيارية = بصمة فاعل، مش ملكية. اقطعها وسيب الصف.
        const detached = await this.q(
          `UPDATE ${ref.table_name} SET ${ref.column_name} = NULL WHERE ${ref.column_name} = ANY($1::uuid[])`,
          [ids],
        ).then(
          () => true,
          () => false, // قيد CHECK بيمنع التفريغ ⇒ العمود ملكية، بنكمّل لمسار الحذف تحت
        );
        if (detached) continue;
      }
      const rows = await this.q(
        `SELECT id FROM ${ref.table_name} WHERE ${ref.column_name} = ANY($1::uuid[])`,
        [ids],
      ).catch(() => null); // جدول بلا عمود `id` — بيتحذف مباشرةً تحت
      if (rows && rows.length) {
        await this.cascadeDelete(ref.table_name, rows.map((r) => r.id), depth + 1);
      } else {
        await this.q(`DELETE FROM ${ref.table_name} WHERE ${ref.column_name} = ANY($1::uuid[])`, [ids]);
      }
    }
    await this.q(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [ids]);
  }

  // ===================== البذر =====================

  /** كتالوج معزول بالكامل (مدينة/نطاق/فئة/خدمة) — مايتلامسش مع بيانات أي تدقيق تاني. */
  async seedCatalog({ priceCents = 10_000, durationMinutes = 60 } = {}) {
    const { prefix } = this;
    const runId = this.nextTag();
    const [country] = await this.q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await this.q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة ${prefix} ${runId}`, `${prefix} City ${runId}`, `${prefix}-city-${runId}`],
    );
    this.created.cityIds.push(city.id);
    const [zone] = await this.q(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [city.id, `نطاق ${prefix} ${runId}`, `${prefix} Zone ${runId}`],
    );
    this.created.zoneIds.push(zone.id);
    const [category] = await this.q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة ${prefix} ${runId}`, `${prefix} Cat ${runId}`, `${prefix}-cat-${runId}`],
    );
    this.created.categoryIds.push(category.id);
    const [service] = await this.q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents,
          estimated_duration_minutes, is_active, allows_individual, allows_team, allows_emergency, allows_scheduling)
       VALUES ($1,$2,$3,'formula',$4,$5,true,true,false,true,true) RETURNING id`,
      [category.id, `خدمة ${prefix} ${runId}`, `${prefix}-service-${runId}`, priceCents, durationMinutes],
    );
    this.created.serviceIds.push(service.id);
    this.catalog = { city, zone, category, service, priceCents };
    return this.catalog;
  }

  /**
   * فني معتمد ومؤهّل لخدمة/منطقة الكتالوج المزروع.
   *
   * `opts.level` اختياري (append-only — كل الكوللرز القدام بيفضلوا `premium` زي ما كانوا):
   * محتاج لأي اختبار بيقيس فلترة على المستوى، زي `eligible_for_team_booking`.
   */
  async makeTechnician(label = 't', opts = {}) {
    const { prefix } = this;
    const level = opts.level ?? 'premium';
    const runId = this.nextTag();
    const [user] = await this.q(
      `INSERT INTO users (phone_number, full_name, user_type, pin_hash, pin_set_at)
       VALUES ($1,$2,'technician',$3,now()) RETURNING id`,
      [this.nextPhone(), `فني ${prefix} ${label} ${runId}`, livePinHash()],
    );
    this.created.users.push(user.id);
    const [tech] = await this.q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, current_level, verification_status, is_available, is_on_duty,
          technician_kind, current_location)
       VALUES ($1,$2,$3::technician_level,'approved',true,true,'technician',
               ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [user.id, `${prefix.toUpperCase()}${label}${runId}`.slice(0, 20), level],
    );
    await this.q(
      `INSERT INTO technician_services (technician_id, service_id, is_active, verification_status)
       VALUES ($1,$2,true,'approved')`,
      [tech.id, this.catalog.service.id],
    );
    await this.q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [
      tech.id,
      this.catalog.zone.id,
    ]);
    return { id: tech.id, userId: user.id, token: this.token(user.id, 'technician') };
  }

  async makeCustomer(label = 'c') {
    const { prefix } = this;
    const runId = this.nextTag();
    const [user] = await this.q(
      `INSERT INTO users (phone_number, full_name, user_type, pin_hash, pin_set_at)
       VALUES ($1,$2,'customer',$3,now()) RETURNING id`,
      [this.nextPhone(), `عميل ${prefix} ${label} ${runId}`, livePinHash()],
    );
    this.created.users.push(user.id);
    const [profile] = await this.q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [user.id]);
    const [address] = await this.q(
      `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
       VALUES ($1,$2,$3,'1',ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography,true) RETURNING id`,
      [user.id, this.catalog.city.id, `شارع ${label}`],
    );
    return { userId: user.id, profileId: profile.id, addressId: address.id, token: this.token(user.id) };
  }

  async makeAdmin() {
    const { prefix } = this;
    const runId = this.nextTag();
    const [user] = await this.q(
      `INSERT INTO users (phone_number, full_name, user_type, pin_hash, pin_set_at)
       VALUES ($1,$2,'admin',$3,now()) RETURNING id`,
      [this.nextPhone(), `أدمن ${prefix} ${runId}`, livePinHash()],
    );
    this.created.users.push(user.id);
    let [role] = await this.q(`SELECT id FROM roles WHERE is_super_admin = true AND deleted_at IS NULL LIMIT 1`);
    if (!role) {
      [role] = await this.q(
        `INSERT INTO roles (name, display_name, is_super_admin, is_active) VALUES ($1,'تدقيق حي',true,true) RETURNING id`,
        [`super_admin_${runId}`],
      );
    }
    await this.q(
      `INSERT INTO employee_profiles (user_id, employee_code, department, is_active) VALUES ($1,$2,'ops',true)`,
      [user.id, `${prefix.toUpperCase()}ADM${runId}`.slice(0, 20)],
    );
    // الدور بيتربط في `user_roles` مش في بروفايل الموظف — ده المصدر اللي `PermissionsGuard` بيقرا منه.
    await this.q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [user.id, role.id]);
    return { userId: user.id, token: this.token(user.id, 'admin') };
  }

  /**
   * موظف بصلاحيات **محدودة** بالاسم — مش super admin.
   *
   * ده المُمثّل اللي بيقيس الفرق بين «مسجّل دخول كموظف» و«مصرّح له بالفعل ده». `makeAdmin()`
   * بيدّي دور `is_super_admin` اللي بيعدّي كل `@RequirePermission` بالتعريف، فأي فحص صلاحيات
   * بيه بيبقى فحص فاضي. الموظف ده بياخد **بالظبط** الصلاحيات اللي اتسمّت وبس.
   *
   * @param {string[]} permissionNames أسماء الصلاحيات من جدول `permissions` (مثال: `orders.view`)
   */
  async makeEmployee(permissionNames = [], label = 'emp') {
    const { prefix } = this;
    const runId = this.nextTag();
    const [user] = await this.q(
      `INSERT INTO users (phone_number, full_name, user_type, pin_hash, pin_set_at)
       VALUES ($1,$2,'admin',$3,now()) RETURNING id`,
      [this.nextPhone(), `موظف ${prefix} ${label} ${runId}`, livePinHash()],
    );
    this.created.users.push(user.id);
    const [role] = await this.q(
      `INSERT INTO roles (name, display_name, is_super_admin, is_active) VALUES ($1,'موظف محدود — تدقيق حي',false,true) RETURNING id`,
      [`limited_${prefix}_${runId}`],
    );
    this.created.roles.push(role.id);
    if (permissionNames.length) {
      await this.q(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE name = ANY($2::text[]) AND deleted_at IS NULL`,
        [role.id, permissionNames],
      );
    }
    await this.q(
      `INSERT INTO employee_profiles (user_id, employee_code, department, is_active) VALUES ($1,$2,'ops',true)`,
      [user.id, `${prefix.toUpperCase()}EMP${runId}`.slice(0, 20)],
    );
    await this.q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [user.id, role.id]);
    return { userId: user.id, roleId: role.id, token: this.token(user.id, 'admin') };
  }

  /**
   * توكن step-up لكل نداء حسّاس — الـguard بيستهلكه مرة واحدة ذرّيًا، فكل محاولة لازم توكن
   * خاص بيها. ده كمان بيشيل الـstep-up من المعادلة فيفضل الحارس الموضوعي هو اللي بيتقاس.
   */
  async stepUpToken(adminUserId) {
    const [row] = await this.q(
      `INSERT INTO step_up_tokens (user_id, expires_at) VALUES ($1, now() + interval '30 minutes') RETURNING id`,
      [adminUserId],
    );
    return row.id;
  }

  async fundWallet(userId, cents) {
    await this.q(
      `INSERT INTO wallets (owner_user_id, owner_type, balance_cents) VALUES ($1,'customer',$2)
       ON CONFLICT (owner_user_id) DO UPDATE SET balance_cents = EXCLUDED.balance_cents`,
      [userId, cents],
    );
  }

  // ===================== ثوابت الدفتر =====================

  /**
   * مجموع قيود التشغيلة دي (debit − credit) لازم يساوي صفر.
   *
   * **مقصود إنه على التشغيلة مش على الجدول كله**: قاعدة التطوير فيها آلاف القيود نصّها التاني
   * اتمسح مع تنظيف مستخدمي تشغيلات قديمة (حذف المستخدم بيجرّ محفظته وقيودها وطرف المنصة بيفضل
   * يتيم) — فرقم الجدول كله أثر تنظيف، مش خلل منتج.
   */
  async ledgerImbalance() {
    const [row] = await this.q(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE -amount_cents END), 0)::bigint AS net,
              count(*)::int AS n
         FROM wallet_transactions WHERE created_at >= $1`,
      [this.startedAt],
    );
    return { net: Number(row.net), rows: row.n };
  }

  /**
   * محفظة المنصة مستثناة عمدًا: خصومات النظام بتمرّ بـ`allowNegativeBalance` بتصميمها. الممنوع
   * قطعًا رصيد عميل أو فني بالسالب — معناه إن النظام صرف فلوس مش موجودة.
   */
  async negativeBalances() {
    if (!this.created.users.length) return [];
    return this.q(
      `SELECT id, owner_user_id, owner_type, balance_cents, reserved_balance_cents FROM wallets
        WHERE owner_user_id = ANY($1::uuid[]) AND owner_type <> 'platform'
          AND (balance_cents < 0 OR reserved_balance_cents < 0)`,
      [this.created.users],
    );
  }

  /** أي رد ‎5xx‎ من أي نداء في التشغيلة — الفشل اللي المالك قال عنه «ما يقعش». */
  async serverErrorsSince() {
    const logPath = path.join(ROOT, '.dev-logs/errors.log');
    if (!fs.existsSync(logPath)) return [];
    const since = new Date(this.startedAt).getTime();
    return fs
      .readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((e) => e && new Date(e.at).getTime() >= since);
  }

  // ===================== إدارة الـAPI =====================

  /**
   * إعادة تشغيل الـAPI من نود مباشرةً. الشغل عبر `execFileSync('bash', ['dev-api.sh'])` بيعلّق:
   * السكريبت بيسيب السيرفر شغّال في الخلفية و`execFileSync` بيفضل مستني أنابيبه تتقفل.
   */
  /**
   * **بَقّة أداة اتصلحت هنا (تدقيق ماراثوني 2026-09-14، docs/08 §148)**: النمط كان
   * `'node ./dist/main.js'` بالنقطة-شرطة — بيطابق النسخة اللي الهارنس نفسه بيشغّلها بس.
   * أي نسخة اتشغّلت بطريقة تانية (`npm run start:dev`، `setsid node dist/main.js`، يدوي)
   * ماكانتش بتتقتل، فالنسخة الجديدة بتموت فورًا على EADDRINUSE والتدقيق بيكمّل وهو بيكلّم
   * **سيرفر بإعدادات قديمة**. اتلقطت مرتين: في `financial-idempotency-audit` (اتصلحت هناك
   * محليًا) وفي `crash-resilience-audit` (كان بيسجّل «الباك-إند اتقتل» وهو عمره ما اتقتل).
   * الإصلاح هنا في المكان المشترك، مع حارس صريح بدل الاعتماد على خروج `pkill`.
   */
  async restartApi() {
    const { execFileSync } = require('node:child_process');
    try {
      execFileSync('pkill', ['-9', '-f', 'dist/main.js'], { stdio: 'ignore' });
    } catch {
      /* مفيش نسخة شغّالة — مش خطأ */
    }
    for (let i = 0; i < 20 && (await this.isApiUp()); i++) await sleep(500);
    if (await this.isApiUp()) {
      throw new Error('فيه نسخة API لسه ماسكة بورت 3000 بعد محاولة الإيقاف — أي قياس بعد كده هيبقى على سيرفر غلط');
    }

    const apiDir = path.join(ROOT, 'apps/api');
    fs.mkdirSync(path.join(apiDir, '.dev-logs'), { recursive: true });
    const log = fs.openSync(path.join(apiDir, '.dev-logs/api.out'), 'a');
    spawn(process.execPath, ['./dist/main.js'], { cwd: apiDir, detached: true, stdio: ['ignore', log, log] }).unref();

    for (let i = 0; i < 90; i++) {
      if (await this.isApiUp()) return;
      await sleep(1000);
    }
    throw new Error('الـAPI مابقاش بيرد بعد إعادة التشغيل');
  }

  /**
   * تعديل إعداد نظام لغرض التدقيق + **إبطال الكاشين + إبلاغ الـAPI الشغّال**.
   *
   * الكتابة المباشرة على SQL بتعدّي على `SettingsService`، فبتفضل القيمة القديمة في كاش Redis
   * (`settings:<key>`) وفي الكاش المحلي — وده بالظبط اللي خلّى تدقيق ج-٢ يقيس قيمة قديمة
   * ويستنتج بَقّة مش موجودة.
   *
   * والـ`pg_notify` تحت مش زيادة: إعدادات معيّنة (عنوان IPA واسم المستلم، مفاتيح Paymob)
   * محمّلة في **ذاكرة** الـprovider وبتتحدّث بحدث مش بقراءة كل مرة، فتعديل الصف لوحده
   * مايكفيش — `provider.isConfigured` يفضل `false` والنداء يرجع 503. القناة دي هي **نفس**
   * القناة اللي `SettingsCrossInstanceBridge` بيسمعها من النسخ التانية (ADR-0075)، فالسكربت
   * بيتصرّف زي نسخة تانية بالظبط بلا أي كود جديد في التطبيق ولا إعادة تشغيل.
   */
  async setSetting(key, jsonValue) {
    await this.q(`UPDATE settings SET value = $2::jsonb, updated_at = now() WHERE key = $1`, [
      key,
      JSON.stringify(jsonValue),
    ]);
    try {
      const Redis = require('/home/user/portalSp/node_modules/ioredis');
      const redis = new Redis(process.env.REDIS_URL ?? ENV.REDIS_URL ?? 'redis://localhost:6379');
      await redis.del(`settings:${key}`);
      redis.disconnect();
    } catch {
      /* Redis واقع = مفيش كاش يتمسح أصلاً */
    }
    // `i` لازم يكون معرّف مختلف عن النسخة الشغّالة عشان مايتجاهلش الإشعار كصدى لنفسه.
    await this.q(`SELECT pg_notify('baytak_setting_updated', $1)`, [
      JSON.stringify({ k: key, i: `live-harness-${process.pid}` }),
    ]);
  }

  async isApiUp() {
    try {
      return (await fetch(`${API}/branding`)).status === 200;
    } catch {
      return false;
    }
  }

  // ===================== التنظيف =====================

  async cleanup() {
    const { execFileSync } = require('node:child_process');
    for (const serviceId of this.created.serviceIds) {
      try {
        execFileSync(process.execPath, [path.join(ROOT, 'scripts/clean-test-data.js'), '--service', serviceId], {
          env: { ...process.env, DATABASE_URL },
          stdio: 'pipe',
        });
      } catch (err) {
        // **السبب الحقيقي بيتطبع، مش سطر «Command failed» بس.** `execFileSync` بيحط رسالة
        // العملية في `stderr` وبيسيب `err.message` سطرًا عامًا — فالتحذير القديم كان طريق
        // مسدود بالظبط زي رسالة تحقق بلا اسم حقل: بتعرف إن فيه فشل ومتعرفش ليه.
        const detail = (err.stderr?.toString() || err.stdout?.toString() || '').trim();
        console.log(
          `تنبيه: تنظيف طلبات الخدمة ${serviceId} فشل — ${detail || String(err).slice(0, 200)}`,
        );
      }
    }
    const techs = await this.q(
      `SELECT id FROM technician_profiles WHERE user_id = ANY($1::uuid[])`,
      [this.created.users],
    );
    await this.cascadeDelete('technician_profiles', techs.map((t) => t.id));
    for (const userId of this.created.users) {
      try {
        await this.cascadeDelete('users', [userId]);
      } catch {
        // مستخدم كتب سجل تدقيق append-only — بيفضل، وده مقصود.
      }
    }
    // `cascadeDelete` مش `DELETE` خام: `clean-test-data.js` فوق بيمسح **الطلبات** بس، لكن فيه
    // صفوف بتشاور على الخدمة من غير أي طلب — أوضحها `booking_funnel_events` اللي بيتسجّل على
    // **مجرد عرض** الخدمة قبل ما يبقى في طلب أصلاً. الصفوف اليتيمة دي كانت بتوقّع
    // `DELETE FROM services` على FK، والتنظيف بيقع بعد تدقيق ناجح فيسيب بيانات وراه.
    await this.cascadeDelete('services', this.created.serviceIds);
    await this.cascadeDelete('service_zones', this.created.zoneIds);
    await this.cascadeDelete('service_categories', this.created.categoryIds);
    await this.cascadeDelete('cities', this.created.cityIds);
    // الأدوار آخر حاجة: `user_roles` بيتمسح مع المستخدم فوق، فالدور بيبقى بلا مراجع هنا.
    await this.q(`DELETE FROM roles WHERE id = ANY($1::uuid[])`, [this.created.roles]);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { LiveHarness, sleep, ROOT, API, ENV, DATABASE_URL, JWT_SECRET, LIVE_TEST_PIN };
