#!/usr/bin/env node
/**
 * **«اللي القايمة بتقول عليه متاح، الحجز بيقبله» — والعكس** (docs/08 §196، ADR-0118).
 *
 * بلاغ المالك بلقطات: «خلي أسطى يختار» بيقول «لا يوجد فني متاح» والقايمة فيها ٤؛ والضغط على فني
 * ظاهر متاح بيرجّع «غير متاح أو غير مؤهل». الجذر: سقف قرار المستوى مفروض في المحرك ومش في القايمة.
 *
 * الثابت اللي السكربت بيفحصه على **كل** منفّذ القايمة بترجّعه، مش على حالة واحدة:
 *   ث-١  كل منفّذ «متاح» في القايمة ⇒ معاينة اختياره يدويًا بتنجح.
 *   ث-٢  كل منفّذ «مش متاح» (أحمر) ⇒ معاينة اختياره بتترفض (العلامة صادقة).
 *   ث-٣  الترشيح التلقائي بينجح ⇔ فيه منفّذ متاح واحد على الأقل، والمرشّح من المتاحين.
 *   ث-٤  منفّذ سقفه أقل من سعره نفسه مايظهرش «متاح».
 *
 *   node scripts/provider-availability-consistency-audit.js [--keep]
 *
 * محتاج الـAPI شغّال بـ`THROTTLE_LIMIT=100000`.
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('pac');
const messageOf = (b) => String(b?.message ?? b?.error?.message ?? '').slice(0, 140);

/** `legacy` = التطبيق المنشور (مابيبعتش `include_ineligible`) — لازم مايشوفش منفّذ مش هيتقبل. */
async function list(customer, scheduledAt, { legacy = false } = {}) {
  const res = await h.api(
    `/services/${h.catalog.service.id}/technicians?address_id=${customer.addressId}&scheduled_at=${encodeURIComponent(scheduledAt)}`
      + (legacy ? '' : '&include_ineligible=1'),
    { token: customer.token },
  );
  return { status: res.status, items: res.body?.data ?? [], message: messageOf(res.body) };
}

async function preview(customer, scheduledAt, body) {
  const res = await h.api('/orders/match-preview', {
    method: 'POST',
    token: customer.token,
    body: { service_id: h.catalog.service.id, address_id: customer.addressId, scheduled_at: scheduledAt, ...body },
  });
  return { ok: res.status === 200 || res.status === 201, status: res.status, data: res.body?.data, message: messageOf(res.body) };
}

const isSelectable = (item) => (item.availability_status ?? 'available') === 'available';
const nameOf = (item) => item.full_name ?? item.name ?? item.id;

/** الثوابت كلها على لقطة واحدة من القايمة — نفس اللحظة اللي العميل بيشوفها. */
async function checkInvariants(label, customer, scheduledAt, levelById) {
  const listed = await list(customer, scheduledAt);
  if (listed.status !== 200) {
    h.record(`${label} القايمة اترجعت`, false, `HTTP=${listed.status} ${listed.message}`);
    return null;
  }
  const selectable = listed.items.filter(isSelectable);
  const red = listed.items.filter((item) => !isSelectable(item));

  const manualFailures = [];
  for (const item of selectable) {
    const res = await preview(customer, scheduledAt, item.is_company
      ? { selection_mode: 'manual', requested_technician_company_id: item.id }
      : { selection_mode: 'manual', technician_id: item.id });
    if (!res.ok) manualFailures.push(`${nameOf(item)} ⇒ ${res.status} ${res.message}`);
  }
  h.record(
    `**${label} ث-١ كل منفّذ «متاح» في القايمة بيتقبل لما العميل يختاره**`,
    manualFailures.length === 0,
    `متاح=${selectable.length}${manualFailures.length ? ` · اترفض: ${manualFailures.join(' | ')}` : ''}`,
  );

  const falseRed = [];
  for (const item of red.filter((i) => !i.is_company)) {
    const res = await preview(customer, scheduledAt, { selection_mode: 'manual', technician_id: item.id });
    if (res.ok) falseRed.push(nameOf(item));
  }
  h.record(
    `${label} ث-٢ كل منفّذ أحمر فعلًا مايتحجزش (العلامة صادقة)`,
    falseRed.length === 0,
    `أحمر=${red.length}${falseRed.length ? ` · بيتحجز رغم إنه أحمر: ${falseRed.join(', ')}` : ''} · أسباب: ${[...new Set(red.map((i) => i.unavailable_reason_ar))].join(' / ') || '—'}`,
  );

  const auto = await preview(customer, scheduledAt, { selection_mode: 'auto' });
  const autoId = auto.data?.provider?.id;
  const autoAmongSelectable = !auto.ok || selectable.some((item) => item.id === autoId);
  h.record(
    `**${label} ث-٣ الترشيح التلقائي ماشي مع القايمة** (بينجح ⇔ فيه متاح، والمرشّح منهم)`,
    auto.ok === selectable.length > 0 && autoAmongSelectable,
    `تلقائي=${auto.ok ? `نجح (${auto.data?.provider?.full_name})` : `فشل ${auto.status} ${auto.message}`} · متاح في القايمة=${selectable.length}`,
  );

  const overCap = selectable.filter((item) => {
    const cap = levelById.get(item.id);
    return !item.is_company && cap != null && Number(item.final_price_cents) > cap;
  });
  h.record(
    `${label} ث-٤ مفيش منفّذ «متاح» وسعره أكبر من سقف مستواه`,
    overCap.length === 0,
    overCap.length ? overCap.map((i) => `${nameOf(i)} ${i.final_price_cents}>${levelById.get(i.id)}`).join(', ') : 'تمام',
  );
  return { selectable, red, auto };
}

async function run() {
  await h.connect();
  console.log(`\n=== اتساق الإتاحة: القايمة ⇔ الترشيح ⇔ الاختيار — تشغيلة ${h.runId} ===\n`);
  // ٦٢٤ج زي لقطة المالك: فوق سقف «جديد» (٢٠٠) و«موثّق» (٥٠٠)، وتحت «محترف» (١٥٠٠).
  await h.seedCatalog({ priceCents: 62_400, durationMinutes: 60 });
  await h.q(`UPDATE services SET show_unavailable_providers = true WHERE id = $1`, [h.catalog.service.id]);
  const caps = new Map(
    (await h.q(`SELECT level::text, decision_limit_cents FROM technician_level_config`)).map((r) => [r.level, r.decision_limit_cents]),
  );
  const techNew = await h.makeTechnician('new', { level: 'new' });
  const techVerified = await h.makeTechnician('ver', { level: 'verified' });
  const techPro = await h.makeTechnician('pro', { level: 'professional' });
  const levelById = new Map([
    [techNew.id, caps.get('new')],
    [techVerified.id, caps.get('verified')],
    [techPro.id, caps.get('professional')],
  ]);
  const customer = await h.makeCustomer('pac');
  const scheduledAt = h.nextDay();

  // شركة كل أعضائها «جديد» ⇒ لازم تبان أحمر على شغلانة ٦٢٤ج (عضو واحد يكفي، ومفيش ولا واحد).
  const weakMember = await h.makeTechnician('cnew', { level: 'new' });
  const [weakCompany] = await h.q(
    `INSERT INTO technician_companies (owner_user_id, name, is_active) VALUES ($1,$2,true) RETURNING id`,
    [weakMember.userId, `شركة ضعيفة ${h.runId}`],
  );
  h.created.companyIds = [...(h.created.companyIds ?? []), weakCompany.id];
  await h.q(`UPDATE technician_profiles SET company_id = $2 WHERE id = $1`, [weakMember.id, weakCompany.id]);

  // ── المرحلة ١: فيه محترف متاح + اتنين سقفهم أقل من الشغلانة ─────────────
  const phase1 = await checkInvariants('م١', customer, scheduledAt, levelById);
  if (phase1) {
    const redIds = new Set(phase1.red.map((i) => i.id));
    h.record(
      'م١ «جديد» و«موثّق» ظاهرين أحمر بسببهم (الخدمة مفعّل فيها إظهار غير المتاحين)',
      redIds.has(techNew.id) && redIds.has(techVerified.id),
      `أحمر: ${phase1.red.map(nameOf).join(', ') || 'مفيش'}`,
    );
    const legacy = await list(customer, scheduledAt, { legacy: true });
    const legacyIds = new Set(legacy.items.map((i) => i.id));
    h.record(
      'م١ التطبيق المنشور (من غير include_ineligible) مابيشوفش «جديد» ولا «موثّق» خالص — مش بيشوفهم متاحين',
      !legacyIds.has(techNew.id) && !legacyIds.has(techVerified.id) && !legacyIds.has(weakCompany.id),
      `ظاهر للتطبيق القديم: ${legacy.items.map(nameOf).join(', ')}`,
    );
    h.record(
      'م١ شركة كل أعضائها سقفهم أقل ⇒ أحمر (مش قابلة للاختيار)',
      redIds.has(weakCompany.id),
      `حالة الشركة: ${(phase1.red.find((i) => i.id === weakCompany.id) ?? phase1.selectable.find((i) => i.id === weakCompany.id))?.availability_status ?? 'مش ظاهرة'}`,
    );
  }

  // ── المرحلة ٢: المحترف اتوقف ⇒ مفيش حد يقدر ياخدها ───────────────────────
  await h.q(`UPDATE technician_profiles SET verification_status = 'suspended' WHERE id = $1`, [techPro.id]);
  await checkInvariants('م٢', customer, scheduledAt, levelById);

  // ── المرحلة ٣: الخدمة مش مفعّل فيها إظهار غير المتاحين ⇒ بيختفوا، والثوابت سارية ──
  await h.q(`UPDATE technician_profiles SET verification_status = 'approved' WHERE id = $1`, [techPro.id]);
  await h.q(`UPDATE services SET show_unavailable_providers = false WHERE id = $1`, [h.catalog.service.id]);
  const phase3 = await checkInvariants('م٣', customer, scheduledAt, levelById);
  // ── المرحلة ٤: شركة بعضو «بريميوم» في أول القايمة ⇒ الترشيح التلقائي يختارها والحجز يعدّي ──
  // العضو حصري للشركة (ADR-0080): تقييم الشركة = تجميع أعضائها، فعضو غير حصري بيتعادل معاها
  // والفرد بييجي الأول — والسيناريو المقصود هنا إن الشركة نفسها على راس القايمة.
  const strongMember = await h.makeTechnician('cpro', { level: 'premium' });
  const [strongCompany] = await h.q(
    `INSERT INTO technician_companies (owner_user_id, name, is_active, price_multiplier) VALUES ($1,$2,true,1.10) RETURNING id`,
    [strongMember.userId, `شركة قوية ${h.runId}`],
  );
  h.created.companyIds.push(strongCompany.id);
  await h.q(
    `UPDATE technician_profiles SET company_id = $2, company_exclusive = true, average_rating = 5, total_ratings_count = 200 WHERE id = $1`,
    [strongMember.id, strongCompany.id],
  );
  const autoCompany = await preview(customer, scheduledAt, { selection_mode: 'auto' });
  h.record(
    'م٤ الترشيح التلقائي بيختار الشركة اللي على رأس القايمة',
    autoCompany.ok && autoCompany.data?.provider_kind === 'company' && autoCompany.data?.provider?.id === strongCompany.id,
    `نتيجة=${autoCompany.ok ? `${autoCompany.data?.provider_kind} ${autoCompany.data?.provider?.full_name}` : `${autoCompany.status} ${autoCompany.message}`}`,
  );
  if (autoCompany.ok) {
    const created = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      headers: { 'Idempotency-Key': `pac-${h.nextTag()}` },
      body: {
        service_id: h.catalog.service.id,
        address_id: customer.addressId,
        scheduled_at: scheduledAt,
        match_preview_id: autoCompany.data.match_preview_id,
        problem_description: 'PAC تدقيق اتساق الإتاحة',
      },
    });
    const [order] = created.body?.data?.id
      ? await h.q(`SELECT total_amount_cents, requested_technician_company_id FROM orders WHERE id = $1`, [created.body.data.id])
      : [];
    h.record(
      '**م٤ الحجز بالشركة المرشّحة تلقائيًا بيعدّي بنفس السعر المعروض**',
      created.status === 201 && order?.requested_technician_company_id === strongCompany.id
        && Number(order?.total_amount_cents) === Number(autoCompany.data.pricing.total_amount_cents),
      `HTTP=${created.status} ${messageOf(created.body)} · المعروض=${autoCompany.data.pricing.total_amount_cents} المحجوز=${order?.total_amount_cents ?? '—'}`,
    );

    // التطبيق المنشور بيبعت معرّف المرشّح التلقائي في `requested_technician_id` مهما كان نوعه —
    // ولو شركة كان الحجز بيترفض («التذكرة دي لشركة»). لازم يعدّي من غير تحديث للتطبيق.
    // يوم تاني: عضو الشركة اتحجز في الميعاد الأول خلاص.
    const legacyAt = new Date(new Date(scheduledAt).getTime() + 86_400_000).toISOString();
    const legacyPreview = await preview(customer, legacyAt, { selection_mode: 'auto' });
    const legacyCreated = legacyPreview.ok
      ? await h.api('/orders', {
        method: 'POST',
        token: customer.token,
        headers: { 'Idempotency-Key': `pac-${h.nextTag()}` },
        body: {
          service_id: h.catalog.service.id,
          address_id: customer.addressId,
          scheduled_at: legacyAt,
          match_preview_id: legacyPreview.data.match_preview_id,
          requested_technician_id: legacyPreview.data.provider.id,
          problem_description: 'PAC التطبيق المنشور',
        },
      })
      : null;
    const [legacyOrder] = legacyCreated?.body?.data?.id
      ? await h.q(`SELECT requested_technician_company_id FROM orders WHERE id = $1`, [legacyCreated.body.data.id])
      : [];
    h.record(
      '**م٤ التطبيق المنشور (معرّف الشركة في خانة الفني) بيحجز بالشركة المرشّحة**',
      legacyCreated?.status === 201 && legacyOrder?.requested_technician_company_id === strongCompany.id,
      `HTTP=${legacyCreated?.status ?? '—'} ${legacyCreated ? messageOf(legacyCreated.body) : legacyPreview.message ?? ''}`,
    );
  }

  if (phase3) {
    h.record(
      'م٣ غير المؤهّلين بالسقف مخفيين لما الخدمة مش بتعرض غير المتاحين',
      phase3.red.length === 0 && !phase3.selectable.some((i) => i.id === techNew.id || i.id === techVerified.id),
      `متاح=${phase3.selectable.map(nameOf).join(', ')}`,
    );
  }
}

run()
  .catch((err) => h.record('خطأ غير متوقع', false, err.stack))
  .finally(async () => {
    if (!KEEP) {
      console.log('\nتنظيف...');
      await h.q(`DELETE FROM booking_match_previews WHERE service_id = ANY($1::uuid[])`, [h.created.serviceIds]).catch(() => {});
      await h.deleteOrders(`problem_description LIKE $1`, ['PAC %']).catch(() => {});
      if (h.created.companyIds?.length) {
        await h.q(`UPDATE technician_profiles SET company_id = NULL, company_exclusive = false WHERE company_id = ANY($1::uuid[])`, [h.created.companyIds]);
        await h.q(`DELETE FROM technician_companies WHERE id = ANY($1::uuid[])`, [h.created.companyIds]).catch((e) => console.log('شركات:', e.message));
      }
      await h.cleanup();
    }
    const failed = h.failures;
    console.log(`\n--- الخلاصة ---\n${h.results.length - failed.length}/${h.results.length} نجحوا`);
    if (failed.length) process.exitCode = 1;
    await h.close();
  });
