#!/usr/bin/env node
/**
 * **بلاغ المالك 2026-09-11**: «طلب معاينة عن طريق الموقع… عيّنت عند الأدمن وقلت له أنا عايز
 * أحوّل الطلب ده لمعاينة على الطبيعة. الطلب اتقبل وراح لفني عندي، وبيّن عند الأدمن إن هو راح
 * للفني. أفتح أكاونت الفني ألاقي إن فعليًا مفيش حاجة جاية — الطلب مش ظاهر أصلًا على صفحة الفني».
 *
 * التدقيق ده بيمشي **نفس المسار بالظبط** على المكدس الكامل وبيسأل السؤال الوحيد المهم:
 * بعد التحويل، الطلب بيظهر في `GET /technician/orders/available` للفني اللي اتبعتله ولا لأ؟
 *
 * وبيفرّق بين تلات احتمالات مختلفة تمامًا (كلهم بيبانوا للمالك كـ«الطلب مش ظاهر»):
 *   أ) مفيش عروض (`order_assignments`) اتعملت أصلاً ⇒ التوزيع ما اشتغلش.
 *   ب) العروض اتعملت بس الاستعلام مابيرجّعهاش ⇒ فلتر غلط في `listAvailableForTechnician`.
 *   ج) العروض اتعملت والاستعلام بيرجّعها ⇒ المشكلة في التطبيق مش الباك-إند.
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('onsite');
  await h.connect();
  const out = [];
  const log = (line) => {
    out.push(line);
    console.log(line);
  };

  try {
    if (!(await h.isApiUp())) {
      console.error('❌ الـAPI مش شغّال — شغّله الأول (cd apps/api && npm run start:dev)');
      process.exit(1);
    }

    const catalog = await h.seedCatalog({ priceCents: 30_000 });
    // الخدمة لازم تسمح بالتقييم بالصور **و**بالمعاينة في الموقع عشان التحويل يبقى ممكن.
    await h.q(
      // `pricing_model='inspection_then_quote'` إجباري: فيه CHECK في القاعدة بيمنع تفعيل
      // التقييم بالصور على أي نموذج تسعير تاني (services_remote_assessment_requires_inspection_model_check).
      `UPDATE services SET remote_assessment_enabled = true, onsite_assessment_enabled = true,
              pricing_model = 'inspection_then_quote',
              inspection_fee_cents = 5000, assessment_route_policy = 'customer_choice'
        WHERE id = $1`,
      [catalog.service.id],
    );

    const admin = await h.makeAdmin();
    const customer = await h.makeCustomer('c');
    const tech = await h.makeTechnician('t');
    // `makeTechnician`/`makeCustomer` بيربطوا الخدمة والنطاق والمدينة أصلاً — مفيش تجهيز زيادة.

    // مسار الصور بيرفض الطلب من غير صورة واحدة على الأقل. بنحط صف رفع مباشرةً بدل multipart
    // حقيقي — التدقيق ده عن **الرؤية بعد التحويل**، مش عن الرفع نفسه (له تدقيقه الخاص).
    const [image] = await h.q(
      `INSERT INTO order_problem_image_uploads
         (customer_id, service_id, storage_key, file_url, mime_type, file_size_bytes)
       VALUES ($1,$2,$3,$4,'image/png',128) RETURNING id`,
      [customer.profileId, catalog.service.id, `audit/${h.runId}.png`, `http://localhost:3000/uploads/audit/${h.runId}.png`],
    );

    // ── ١) العميل بيعمل طلب «تقييم بالصور» ────────────────────────────────
    const created = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      body: {
        service_id: catalog.service.id,
        address_id: customer.addressId,
        booking_mode: 'individual',
        problem_description: 'تسريب في المواسير — تقييم بالصور',
        request_remote_quote: true,
        problem_image_ids: [image.id],
      },
    });
    if (created.status !== 201 && created.status !== 200) {
      log(`❌ فشل إنشاء طلب التقييم بالصور (HTTP ${created.status}): ${JSON.stringify(created.body).slice(0, 400)}`);
      process.exit(1);
    }
    const orderId = created.body?.data?.id ?? created.body?.id;
    const [row0] = await h.q(`SELECT order_status, assessment_type, total_amount_cents FROM orders WHERE id=$1`, [orderId]);
    log(`① الطلب اتعمل: status=${row0.order_status} assessment=${row0.assessment_type} total=${row0.total_amount_cents}`);

    // ── ٢) الأدمن بيحوّله لمعاينة في الموقع ───────────────────────────────
    // المسار محمي بـstep-up (Passkey حديث) — نفس ما الأدمن الحقيقي بيعمل.
    const stepUp = await h.stepUpToken(admin.userId);
    const routed = await h.api(`/admin/orders/${orderId}/route-to-onsite-assessment`, {
      method: 'POST',
      token: admin.token,
      headers: { 'x-step-up-token': stepUp },
      body: { reason: 'الصور مش كافية لتحديد المشكلة' },
    });
    log(`② تحويل لمعاينة ميدانية: HTTP ${routed.status}`);
    if (routed.status >= 400) {
      log(`   ${JSON.stringify(routed.body).slice(0, 400)}`);
      process.exit(1);
    }

    // التوزيع بيحصل على حدث غير متزامن — بنستنى شوية وبنقيس.
    await new Promise((r) => setTimeout(r, 3000));

    const [row1] = await h.q(
      `SELECT order_status, assessment_type, price_status, total_amount_cents, technician_id FROM orders WHERE id=$1`,
      [orderId],
    );
    log(
      `③ بعد التحويل: status=${row1.order_status} assessment=${row1.assessment_type} ` +
        `price_status=${row1.price_status} total=${row1.total_amount_cents}`,
    );

    // ── ٣) العروض اتعملت فعلاً؟ ───────────────────────────────────────────
    const assignments = await h.q(
      `SELECT technician_id, assignment_status, sent_at, expires_at FROM order_assignments WHERE order_id=$1`,
      [orderId],
    );
    log(`④ عروض التوزيع (order_assignments): ${assignments.length} صف`);
    for (const a of assignments) {
      log(`   • فني=${a.technician_id === tech.id ? 'فنينا' : a.technician_id} حالة=${a.assignment_status}`);
    }

    // ── ٤) السؤال الحقيقي: الفني شايفه؟ ───────────────────────────────────
    const available = await h.api('/technician/orders/available', { token: tech.token });
    const items = available.body?.data ?? [];
    const found = items.some((i) => i.order_id === orderId);
    log(`⑤ GET /technician/orders/available: HTTP ${available.status} — ${items.length} طلب، الطلب ده ${found ? 'ظاهر ✅' : 'مش ظاهر ❌'}`);

    const active = await h.api('/technician/orders/active-orders', { token: tech.token });
    const activeItems = active.body?.data ?? [];
    log(`⑥ GET /technician/orders/active-orders: HTTP ${active.status} — ${activeItems.length} طلب`);

    // ── ٥) السيناريو التاني: الأدمن بيعيّن فني بعينه (مش بث) ─────────────
    // ده اللي المالك وصفه بالحرف: «بيّن عند الأدمن إن هو راح للفني».
    log('');
    log('══ سيناريو ب: الأدمن بيعيّن الفني بنفسه (POST /admin/orders/:id/reassign) ══');
    const tech2 = await h.makeTechnician('t2');
    const reassigned = await h.api(`/admin/orders/${orderId}/reassign`, {
      method: 'POST',
      token: admin.token,
      headers: { 'x-step-up-token': await h.stepUpToken(admin.userId) },
      body: { technician_id: tech2.id, reason: 'الفني ده أقرب للعميل' },
    });
    log(`⑦ تعيين يدوي: HTTP ${reassigned.status}`);
    if (reassigned.status >= 400) log(`   ${JSON.stringify(reassigned.body).slice(0, 300)}`);

    const [row2] = await h.q(`SELECT order_status, technician_id FROM orders WHERE id=$1`, [orderId]);
    log(`⑧ حالة الطلب بعد التعيين: status=${row2.order_status} technician=${row2.technician_id === tech2.id ? 'الفني الجديد ✅' : row2.technician_id}`);

    const asg2 = await h.q(
      `SELECT assignment_status, count(*)::int AS n FROM order_assignments WHERE order_id=$1 GROUP BY assignment_status`,
      [orderId],
    );
    log(`⑨ عروض التوزيع دلوقتي: ${asg2.map((a) => `${a.assignment_status}=${a.n}`).join(', ') || 'مفيش'}`);

    const avail2 = await h.api('/technician/orders/available', { token: tech2.token });
    const act2 = await h.api('/technician/orders/active-orders', { token: tech2.token });
    const upc2 = await h.api('/technician/orders/upcoming-confirmed', { token: tech2.token });
    const inAvail = (avail2.body?.data ?? []).some((i) => i.order_id === orderId);
    const inActive = (act2.body?.data ?? []).some((i) => i.id === orderId);
    const inUpcoming = (upc2.body?.data ?? []).some((i) => i.id === orderId);
    log(`⑩ الفني المعيَّن بيشوف الطلب في:`);
    log(`   • /available          → ${inAvail ? 'ظاهر ✅' : 'مش ظاهر ❌'}`);
    log(`   • /active-orders      → ${inActive ? 'ظاهر ✅' : 'مش ظاهر ❌'}`);
    log(`   • /upcoming-confirmed → ${inUpcoming ? 'ظاهر ✅' : 'مش ظاهر ❌'}`);

    if (!inAvail && !inActive && !inUpcoming) {
      log('');
      log('🔴🔴 **الطلب متعيّن للفني ومش ظاهر في أي مسار من تطبيقه** — ده بلاغ المالك بالحرف.');
      log(`     الحالة \`${row2.order_status}\` مش في ACTIVE_TECHNICIAN_ORDER_STATUSES ولا في`);
      log('     ENGAGED_TECHNICIAN_ORDER_STATUSES، و/available بتطلب searching_technician + عرض قايم.');
    }

    // ── الحكم ─────────────────────────────────────────────────────────────
    log('');
    if (assignments.length === 0) {
      log('🔴 الحكم: **مفيش عروض اتعملت خالص** — التوزيع ما اشتغلش بعد التحويل.');
      log('   يعني الطلب قاعد في searching_technician ومحدش اتبعتله — والأدمن ممكن يبان له غير كده.');
    } else if (!found) {
      log('🔴 الحكم: **العروض اتعملت بس الفني مش شايفها** — الفلتر في listAvailableForTechnician بيسقّطها.');
    } else {
      log('🟢 الحكم: الباك-إند بيرجّع الطلب للفني — المشكلة لو موجودة بتبقى في التطبيق نفسه.');
    }

    // تشخيص إضافي: نعيد نفس استعلام الباك-إند بالحرف ونشوف كل شرط بيسقّط إيه.
    if (assignments.length > 0 && !found) {
      const diag = await h.q(
        `SELECT oa.assignment_status, o.order_status, o.deleted_at IS NULL AS not_deleted,
                (s.id IS NOT NULL) AS has_service, (a.id IS NOT NULL) AS has_address
           FROM order_assignments oa
           JOIN orders o ON o.id = oa.order_id
           LEFT JOIN services s ON s.id = o.service_id
           LEFT JOIN addresses a ON a.id = o.address_id
          WHERE oa.order_id = $1 AND oa.technician_id = $2`,
        [orderId, tech.id],
      );
      log('   تشخيص الشروط:');
      for (const d of diag) log(`   • ${JSON.stringify(d)}`);
    }
  } finally {
    await h.cleanup();
    await h.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
