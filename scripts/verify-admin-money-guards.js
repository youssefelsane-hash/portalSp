/**
 * **تحقق حي من الأدمن للقاعدة: حراسات الفلوس والإعدادات** (docs/08 §188).
 *
 * الاختبارات جوّه `apps/api` بتختبر الدوال. ده بيختبر **المسار الحقيقي** اللي شاشة الأدمن بتمشي
 * فيه: HTTP + JWT حقيقي + `StepUpGuard` + `ValidationPipe` + الكونترولر + القاعدة. لأن كل عطل
 * في الجولة دي كان بالظبط في الطبقة دي — decorator ناقص، header مش متبعت، حد مش متفرض.
 *
 *   node scripts/verify-admin-money-guards.js
 *
 * محتاج الـAPI شغّال بـ`THROTTLE_LIMIT=100000`.
 */
'use strict';

const { randomUUID } = require('node:crypto');
const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('amg');
  await h.connect();
  const results = [];
  const record = (label, ok, detail) => results.push({ label, ok, detail });
  const data = (r) => r.body?.data ?? r.body;
  const code = (r) => r.body?.error?.code ?? r.body?.code ?? '';
  const message = (r) => (r.body?.error?.message ?? r.body?.message ?? '').toString();

  let surchargeBefore;
  try {
    await h.seedCatalog({ priceCents: 30_000, durationMinutes: 60 });
    const tech = await h.makeTechnician('t');
    const admin = await h.makeAdmin();

    // الفني عليه دين 100 ج (عمولة كاش) — نفس الحالة الحقيقية.
    const [platform] = await h.q(`SELECT id FROM wallets WHERE owner_type = 'platform' LIMIT 1`);
    const [techWallet] = await h.q(
      `INSERT INTO wallets (owner_user_id, owner_type, balance_cents) VALUES ($1,'technician',-10000)
       ON CONFLICT (owner_user_id) DO UPDATE SET balance_cents = -10000 RETURNING id`,
      [tech.userId],
    );
    void platform;
    const settle = (headers, amount = 10_000) =>
      h.api(`/admin/technicians/${tech.id}/debt/settlements`, {
        method: 'POST',
        token: admin.token,
        headers,
        body: { amount_cents: amount, method: 'cash' },
      });

    // ── ١) السداد من غير Passkey حديث بيترفض (كان بيعدّي قبل §188) ──
    const noStepUp = await settle({ 'Idempotency-Key': randomUUID() });
    record('سداد بلا step-up ⇒ مرفوض بطلب تأكيد الهوية', noStepUp.status === 403 && code(noStepUp) === 'AUTH_006',
      `HTTP ${noStepUp.status} ${code(noStepUp)}`);

    // ── ٢) من غير Idempotency-Key بيترفض ──
    const noKey = await settle({ 'X-Step-Up-Token': await h.stepUpToken(admin.userId) });
    record('سداد بلا Idempotency-Key ⇒ 400', noKey.status === 400, `HTTP ${noKey.status} «${message(noKey)}»`);

    // ── ٣) الإعادة بنفس المفتاح: نفس النتيجة ومفيش حركة فلوس تانية ──
    const key = randomUUID();
    const first = await settle({ 'X-Step-Up-Token': await h.stepUpToken(admin.userId), 'Idempotency-Key': key }, 4_000);
    const replay = await settle({ 'X-Step-Up-Token': await h.stepUpToken(admin.userId), 'Idempotency-Key': key }, 4_000);
    const [{ n: rows }] = await h.q(
      `SELECT COUNT(*)::int AS n FROM technician_debt_settlements WHERE technician_id = $1`,
      [tech.id],
    );
    record('الإعادة بنفس المفتاح ⇒ سجل واحد ورصيد واحد',
      first.status < 300 && replay.status < 300 && data(first).balanceCents === -6000 &&
        data(replay).balanceCents === -6000 && rows === 1,
      `أول ${first.status} رصيد ${data(first)?.balanceCents} · إعادة ${replay.status} رصيد ${data(replay)?.balanceCents} · سجلات ${rows}`);

    // ── ٤) سدادين متزامنين للباقي كله: واحد بس بيعدّي ──
    const [a, b] = await Promise.all([
      settle({ 'X-Step-Up-Token': await h.stepUpToken(admin.userId), 'Idempotency-Key': randomUUID() }, 6_000),
      settle({ 'X-Step-Up-Token': await h.stepUpToken(admin.userId), 'Idempotency-Key': randomUUID() }, 6_000),
    ]);
    const [{ balance_cents: finalBalance }] = await h.q(`SELECT balance_cents FROM wallets WHERE id = $1`, [techWallet.id]);
    const okCount = [a, b].filter((r) => r.status < 300).length;
    record('سدادين متزامنين ⇒ واحد بس، والرصيد صفر مش +60',
      okCount === 1 && Number(finalBalance) === 0,
      `نجح ${okCount} من 2 · الرصيد النهائي ${finalBalance}`);

    // ── ٥) معامل سعر الشركة بقى محتاج step-up ──
    const [owner] = await h.q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,'صاحب شركة','technician') RETURNING id`,
      [h.nextPhone()],
    );
    h.created.users.push(owner.id);
    const [company] = await h.q(
      `INSERT INTO technician_companies (owner_user_id,name,is_active) VALUES ($1,$2,true) RETURNING id`,
      [owner.id, `شركة ${h.nextTag()}`],
    );
    const multiplier = await h.api(`/admin/technician-companies/${company.id}/price-multiplier`, {
      method: 'PATCH',
      token: admin.token,
      body: { price_multiplier: 1.2 },
    });
    record('معامل سعر الشركة بلا step-up ⇒ مرفوض', multiplier.status === 403 && code(multiplier) === 'AUTH_006',
      `HTTP ${multiplier.status} ${code(multiplier)}`);
    await h.q(`DELETE FROM technician_companies WHERE id = $1`, [company.id]);

    // ── ٦) حدود الإعدادات من الـHTTP ──
    [{ value: surchargeBefore }] = await h.q(`SELECT value FROM settings WHERE key = 'pricing.emergency_surcharge_percentage'`);
    const patchSetting = async (value) =>
      h.api('/admin/settings/pricing.emergency_surcharge_percentage', {
        method: 'PATCH',
        token: admin.token,
        headers: { 'X-Step-Up-Token': await h.stepUpToken(admin.userId) },
        body: { value },
      });
    const absurd = await patchSetting(900);
    record('رسوم طوارئ 900% ⇒ مرفوضة برسالة الحد', absurd.status === 400 && /من 0 لـ100/.test(message(absurd)),
      `HTTP ${absurd.status} «${message(absurd)}»`);
    const sane = await patchSetting(25);
    record('رسوم طوارئ 25% ⇒ مقبولة', sane.status < 300, `HTTP ${sane.status}`);

    const list = await h.api('/admin/settings', { token: admin.token });
    const row = (data(list) ?? []).find((s) => s.key === 'pricing.emergency_surcharge_percentage');
    record('الأدمن بياخد الحد في الرد (allowed_range)', row?.allowed_range?.min === 0 && row?.allowed_range?.max === 100,
      JSON.stringify(row?.allowed_range));
  } finally {
    if (surchargeBefore !== undefined) await h.setSetting('pricing.emergency_surcharge_percentage', surchargeBefore);
    await h.q(`DELETE FROM technician_debt_settlements WHERE recorded_by_user_id = ANY($1::uuid[])`, [h.created.users]).catch(() => {});
    await h.cleanup();
    await h.close();
  }

  console.log('\n— حراسات الفلوس والإعدادات من الأدمن للقاعدة —\n');
  let allOk = true;
  for (const { label, ok, detail } of results) {
    if (!ok) allOk = false;
    console.log(`${ok ? '✅' : '❌'} ${label}\n     ${detail}\n`);
  }
  console.log(allOk ? '✅ كل الحراسات شغّالة من المسار الحقيقي.' : '❌ فيه حراسة مش شغّالة من المسار الحقيقي.');
  if (!allOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
