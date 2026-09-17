/**
 * **تحقّق حي: فلتري «الطاقم ناقص» و«حالة الدفع» في صفحة الطلبات** (docs/08 §157/§158).
 *
 * الفلتر الأول (`crew=incomplete`) بيكتب قاعدة `computeCrewComposition` تاني في SQL — القائد
 * بيتحسب +1 والأعضاء بـ`crew_slot` مش `member_type` (ADR-0101). أي انحراف في النسخة دي بيخلّي
 * شريط الملخّص يقول رقم والقايمة تعرض غيره، وده بالظبط اللي الأدمن بيبني عليه قراره.
 *
 * التحقّق بيشمل **ضوابط نفي**: الطلب لازم يخرج من الفلتر بالظبط لما الطاقم يكتمل، مش قبل.
 *
 *   node scripts/verify-orders-crew-payment-filters.js   # محتاج API شغّال على 3000
 */
const { LiveHarness } = require('/home/user/portalSp/scripts/lib/live-harness');
(async () => {
  const h = new LiveHarness('vfx');
  await h.connect();
  try {
    await h.seedCatalog({ priceCents: 30000, durationMinutes: 120 });
    const customer = await h.makeCustomer('c');
    const tech = await h.makeTechnician('t');
    const admin = await h.makeEmployee(['orders.view'], 'ops');
    const at = new Date(Date.now() + 86400000); at.setUTCHours(9,0,0,0);
    const mk = async (tag, requiredTech, paid) => {
      const [o] = await h.q(
        `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
           order_status, booking_mode, scheduled_at, duration_minutes, technician_id,
           required_technicians, required_assistants, placed_at, total_amount_cents,
           payment_method, payment_status, commission_rate_applied, problem_description)
         VALUES ($1,$2,$3,$4,$5,'accepted','individual',$6,120,$7,$8,0,$6,30000,'cash',$9,20.00,'x')
         RETURNING id`,
        [customer.profileId, h.catalog.service.id, customer.addressId, h.catalog.zone.id,
         `VFX-${tag}`, at.toISOString(), tech.id, requiredTech, paid ? 'paid' : 'pending'],
      );
      return o.id;
    };
    // طاقم ناقص: محتاج 3 والقائد بس موجود (مفيش أعضاء execution)
    const incompleteId = await mk('inc', 3, false);
    // طاقم كامل: محتاج 1 والقائد بيغطّيه
    const completeId = await mk('cmp', 1, true);

    const q = async (qs) => {
      const r = await h.api(`/admin/orders?${qs}&per_page=100`, { token: admin.token });
      return (r.body.data ?? []).filter((o) => o.order_number.startsWith('VFX-')).map((o) => o.order_number).sort();
    };
    const all = await q('scope=all');
    const inc = await q('scope=all&crew=incomplete');
    const paid = await q('scope=all&payment_status=paid');
    const pending = await q('scope=all&payment_status=pending');
    const s = await h.api('/admin/orders/summary?scope=all', { token: admin.token });

    const ok = (label, cond, extra='') => console.log(`${cond ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`);
    ok('الطلبين الاتنين في النطاق الكامل', all.length === 2, JSON.stringify(all));
    ok('`crew=incomplete` بيرجّع الناقص بس', inc.length === 1 && inc[0] === 'VFX-inc', JSON.stringify(inc));
    ok('`payment_status=paid` بيرجّع المدفوع بس', paid.length === 1 && paid[0] === 'VFX-cmp', JSON.stringify(paid));
    ok('`payment_status=pending` بيرجّع غير المدفوع بس', pending.length === 1 && pending[0] === 'VFX-inc', JSON.stringify(pending));
    ok('الملخّص بيقرا نفس القاعدة (crew_incomplete ≥ 1)', (s.body.data?.crew_incomplete ?? 0) >= 1, `crew_incomplete=${s.body.data?.crew_incomplete}`);
    // النفي: لو أضفنا عضو execution للطلب الناقص، لازم يخرج من الفلتر
    await h.q(
      `INSERT INTO order_team_members (order_id, technician_id, member_type, crew_slot, role_label, added_by_technician_id)
       VALUES ($1,$2,'team_member','execution','فني تنفيذ',$2)`, [incompleteId, tech.id]);
    const inc2 = await q('scope=all&crew=incomplete');
    ok('بعد ما الخانة اتملت: لسه ناقص (3 > 1+1)', inc2.includes('VFX-inc'), JSON.stringify(inc2));
    const t2 = await h.makeTechnician('t2');
    await h.q(
      `INSERT INTO order_team_members (order_id, technician_id, member_type, crew_slot, role_label, added_by_technician_id)
       VALUES ($1,$2,'team_member','execution','فني تنفيذ',$3)`, [incompleteId, t2.id, tech.id]);
    const inc3 = await q('scope=all&crew=incomplete');
    ok('بعد اكتمال الطاقم (3 = 1+2): خرج من الفلتر', !inc3.includes('VFX-inc'), JSON.stringify(inc3));
    void completeId;
  } finally {
    await h.deleteOrders(`order_number LIKE $1`, ['VFX-%']);
    await h.cleanup();
    await h.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
