#!/usr/bin/env node
/**
 * **«الطلب متعيّن لفني ومش ظاهر في تطبيقه» — تدقيق شامل بدل تخمين المسار.**
 *
 * بلاغ المالك 2026-09-11: «بيّن عند الأدمن إن هو راح للفني. أفتح أكاونت الفني ألاقي إن فعليًا
 * مفيش حاجة جاية — الطلب مش ظاهر أصلًا على صفحة الفني».
 *
 * إعادة إنتاج مسار واحد بعينه مابتجاوبش السؤال الحقيقي. السؤال الحقيقي هو:
 *
 *   **هل فيه أي حالة طلب، الطلب فيها متعيّن لفني، ومش بترجع في أي مسار من مسارات تطبيقه؟**
 *
 * التدقيق ده بيعدّي على **كل** حالة في `OrderStatus`، بنسختين (مجدول / غير مجدول)، وبيسأل
 * التلات مسارات اللي التطبيق بيقرا منهم فعلاً:
 *   • `GET /technician/orders/available`          (عروض مفتوحة)
 *   • `GET /technician/orders/active-orders`      (الشغل الحالي)
 *   • `GET /technician/orders/upcoming-confirmed` (المؤكّد قدامه)
 *
 * أي حالة «متعيّنة + مخفية» = شغل حقيقي ضايع بين الأدمن والفني.
 *
 * بيشتغل **على قاعدة البيانات مباشرة** لضبط الحالة (مش عبر الـAPI): الغرض قياس **الرؤية**،
 * مش انتقالات آلة الحالة — وده بيخلّينا نغطّي حالات مستحيل نوصلها بمسار مستخدم في دقيقتين.
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

/** الحالات اللي **مالهاش معنى** إن فني يشوفها — مفيش تعيين أصلاً أو الطلب خلص/اتلغى. */
const NOT_TECHNICIAN_FACING = new Set([
  'draft',
  'pending_payment',
  'awaiting_admin_quote',
  'awaiting_technician_selection',
  'searching_technician', // العرض مفتوح للكل، مش تعيين
  'completed',
  'cancelled_by_customer',
  'cancelled_by_technician',
  'cancelled_by_system',
  'expired',
  'refunded',
  'awaiting_technician_reselection', // العميل بيختار بديل — الفني القديم اتشال
]);

async function main() {
  const h = new LiveHarness('tvis');
  await h.connect();

  try {
    if (!(await h.isApiUp())) {
      console.error('❌ الـAPI مش شغّال');
      process.exit(1);
    }

    const catalog = await h.seedCatalog({ priceCents: 30_000 });
    const customer = await h.makeCustomer('c');
    const tech = await h.makeTechnician('t');

    // صف لكل حالة — `array_agg` بيرجّع نص مصفوفة Postgres مش مصفوفة JS.
    const statusRows = await h.q(
      `SELECT e.enumlabel AS status
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'order_status'
        ORDER BY e.enumsortorder`,
    );
    const enumlabels = statusRows.map((r) => r.status);

    const findings = [];
    let checked = 0;

    for (const status of enumlabels) {
      if (NOT_TECHNICIAN_FACING.has(status)) continue;

      for (const scheduled of [false, true]) {
        const [order] = await h.q(
          `INSERT INTO orders (commission_rate_applied, order_number, customer_id, service_id, address_id,
                               service_zone_id, technician_id, order_status, payment_status,
                               total_amount_cents, technician_earning_cents, booking_mode, scheduled_at)
           VALUES (20, $1, $2, $3, $4, $5, $6, $7::order_status, 'pending', 30000, 24000, 'individual', $8)
           RETURNING id`,
          [
            `TV-${h.runId}-${checked}`.slice(0, 24),
            customer.profileId,
            catalog.service.id,
            customer.addressId,
            catalog.zone.id,
            tech.id,
            status,
            scheduled ? new Date(Date.now() + 86_400_000) : null,
          ],
        );
        checked++;

        const [avail, active, upcoming] = await Promise.all([
          h.api('/technician/orders/available', { token: tech.token }),
          h.api('/technician/orders/active-orders', { token: tech.token }),
          h.api('/technician/orders/upcoming-confirmed', { token: tech.token }),
        ]);
        const seen =
          (avail.body?.data ?? []).some((i) => i.order_id === order.id) ||
          (active.body?.data ?? []).some((i) => i.id === order.id) ||
          (upcoming.body?.data ?? []).some((i) => i.id === order.id);

        if (!seen) findings.push({ status, scheduled });
        await h.q(`DELETE FROM orders WHERE id = $1`, [order.id]);
      }
    }

    console.log(`\n════ فحص ${checked} تركيبة (حالة × مجدول/غير مجدول) ════\n`);
    if (findings.length === 0) {
      console.log('🟢 كل طلب متعيّن لفني بيظهر في مسار واحد على الأقل من تطبيقه.');
    } else {
      console.log(`🔴 ${findings.length} تركيبة: الطلب متعيّن للفني و**مش ظاهر في أي مسار**:\n`);
      for (const f of findings) {
        console.log(`   • ${f.status.padEnd(34)} ${f.scheduled ? '(مجدول)' : '(غير مجدول)'}`);
      }
      console.log('\n   يعني الأدمن شايف الطلب متعيّن، والفني مش شايف حاجة — شغل ضايع بين الاتنين.');
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
