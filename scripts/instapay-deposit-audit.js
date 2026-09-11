#!/usr/bin/env node
/**
 * **تدقيق مسار InstaPay والعربون** (طلب المالك 2026-09-11).
 *
 * > «InstaPay دي وسيلة الدفع اللي أنا عايزها تكون أساسية لكل الناس… تأكد إن صفحة InstaPay
 * >  شغالة بفعالية، مفيهاش أي مشاكل، حتى لو شخص طلع من صفحة الدفع وعايز يدخل تاني، أو طلع
 * >  من الأبليكيشن خالص وراح على InstaPay وبعدين رجع عشان ياخد الرقم copy.»
 *
 * بيقيس على الـAPI الحقيقي:
 *   ١. ترتيب وسائل الدفع: InstaPay فوق، الكاش تحتها.
 *   ٢. وسم الترشيح على InstaPay بس، ومربوط بإعداد مش بثابت في الكود.
 *   ٣. تفاصيل التحويل حقول مستقلة (حساب/مبلغ/رقم طلب) مش نص واحد.
 *   ٤. **الاستئناف**: نداء الـGET أكتر من مرة بيرجّع نفس الأرقام ومابيعملش دفعة جديدة.
 *   ٥. وعد وقت التأكيد جاي من الإعدادات (٢٠ / ٦٠).
 *   ٦. العربون: الافتراضي عربون، و`pay_full_amount` بيلغيه فيتدفع الطلب كامل.
 */
'use strict';

const { execFileSync } = require('child_process');
const { join } = require('path');
const { LiveHarness } = require('./lib/live-harness');

const VERBOSE = process.argv.includes('--verbose');
const PRICE_CENTS = 80_000;
const DEPOSIT_PCT = 25;

const failures = [];
const checks = [];

function check(scenario, name, actual, expected, note) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ ok });
  if (!ok) failures.push({ scenario, name, actual, expected, note });
  if (VERBOSE || !ok) {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : `  — طلع ${JSON.stringify(actual)}، المفروض ${JSON.stringify(expected)}${note ? ` (${note})` : ''}`}`);
  }
}

async function main() {
  const h = new LiveHarness('ipd');
  await h.connect();
  const orderIds = [];

  try {
    if (!(await h.isApiUp())) {
      console.error('❌ الـAPI مش شغّال');
      process.exit(1);
    }

    const catalog = await h.seedCatalog({ priceCents: PRICE_CENTS });
    const customer = await h.makeCustomer('c');
    const admin = await h.makeAdmin();
    await h.makeTechnician('t');

    // **الإعدادات بتتظبط عبر مسار الأدمن مش بـSQL مباشر.**
    //
    // `InstaPayProvider` بيكاش عنوان الـIPA في الذاكرة وبيعيد تحميله على `SETTING_UPDATED_EVENT`
    // اللي `SettingsService.update()` بس بيطلقه. الكتابة المباشرة في الجدول بتعدّي من تحت
    // الكاش، فالمزوّد يفضل شايف القيمة القديمة و`isConfigured` تفضل false — وده بالظبط اللي
    // خلّى أول تشغيلة للتدقيق ده ترجّع 503. الطريق ده كمان هو اللي الأوبس بيستخدمه فعلاً.
    const setSetting = async (key, value) => {
      const res = await h.api(`/admin/settings/${key}`, {
        method: 'PATCH', token: admin.token,
        headers: { 'x-step-up-token': await h.stepUpToken(admin.userId) },
        body: { value },
      });
      if (res.status !== 200 && res.status !== 201) {
        throw new Error(`ضبط ${key} فشل (${res.status}): ${JSON.stringify(res.body?.error ?? res.body)}`);
      }
    };
    await setSetting('payments.instapay.ipa_address', 'osta@instapay');
    await setSetting('payments.instapay.recipient_name', 'Osta Home');
    await setSetting('payments.instapay_enabled', true);

    console.log('\n═══ ١ — ترتيب وسائل الدفع والترشيح ═══');
    const channels = await h.api('/payment-channels', { token: customer.token });
    check('ترتيب', 'قايمة الوسائل ردّت', channels.status, 200);
    if (channels.status === 200) {
      const rows = channels.body?.data ?? [];
      const methods = rows.map((row) => row.method);
      check('ترتيب', 'InstaPay أول واحدة', methods[0], 'instapay');
      check('ترتيب', 'الكاش تحتها', methods[1], 'cash');
      const recommended = rows.filter((row) => row.is_recommended).map((row) => row.method);
      check('ترتيب', 'الترشيح على InstaPay بس', recommended, ['instapay']);
      const instapay = rows.find((row) => row.method === 'instapay');
      check('ترتيب', 'نص الوسم جاي من الباك-إند', typeof instapay?.recommended_label_ar, 'string');
      if (VERBOSE) console.log(`   الترتيب: ${methods.join(' → ')}`);
    }

    console.log('\n═══ ٢ — تفاصيل التحويل + الاستئناف ═══');
    {
      const [order] = await h.q(
        `INSERT INTO orders (commission_rate_applied, order_number, customer_id, service_id, address_id,
           service_zone_id, order_status, payment_status, total_amount_cents, commissionable_base_cents,
           technician_earning_cents, booking_mode, settlement_policy_version)
         VALUES (20,$1,$2,$3,$4,$5,'pending_payment','unpaid',$6,$6,0,'individual',2)
         RETURNING id, order_number`,
        [`IPD-${h.runId}`.slice(0, 24), customer.profileId, catalog.service.id, customer.addressId,
         catalog.zone.id, PRICE_CENTS],
      );
      orderIds.push(order.id);

      const started = await h.api(`/orders/${order.id}/pay-with-instapay`, {
        method: 'POST', token: customer.token,
        headers: { 'Idempotency-Key': `ipd-${h.runId}` },
      });
      check('تحويل', 'بدء التحويل عدّى', started.status, 201,
        started.status !== 201 ? JSON.stringify(started.body?.error ?? started.body).slice(0, 200) : undefined);

      if (started.status === 201) {
        const first = started.body.data;
        check('تحويل', 'الحساب حقل مستقل', first.recipient_address, 'osta@instapay');
        check('تحويل', 'اسم المستلم حقل مستقل', first.recipient_name, 'Osta Home');
        check('تحويل', 'المبلغ حقل مستقل', first.amount_cents, PRICE_CENTS);
        check('تحويل', 'رقم الطلب هو الكود المرجعي', first.reference_code, order.order_number);
        // **الأرقام مش مدفونة في النص** — ده جوهر بلاغ الـbidi.
        check('تحويل', 'نص التعليمات مافيهوش الحساب',
          first.instructions_ar.includes('osta@instapay'), false,
          'رقم/حساب جوّه جملة عربية بيتقلب على الشاشة');
        check('تحويل', 'نص التعليمات مافيهوش رقم الطلب',
          first.instructions_ar.includes(order.order_number), false);
        check('تحويل', 'وعد التأكيد المعتاد', first.confirm_typical_minutes, 20);
        check('تحويل', 'سقف وعد التأكيد', first.confirm_max_minutes, 60);

        // **الاستئناف**: العميل خرج لتطبيق البنك ورجع.
        const paymentsBefore = await h.q(
          `SELECT COUNT(*)::int AS n FROM payments WHERE order_id = $1`, [order.id]);
        const resumed1 = await h.api(`/orders/${order.id}/instapay-transfer`, { token: customer.token });
        const resumed2 = await h.api(`/orders/${order.id}/instapay-transfer`, { token: customer.token });
        const paymentsAfter = await h.q(
          `SELECT COUNT(*)::int AS n FROM payments WHERE order_id = $1`, [order.id]);

        check('استئناف', 'الاستئناف ردّ', resumed1.status, 200,
          resumed1.status !== 200 ? JSON.stringify(resumed1.body?.error ?? '').slice(0, 200) : undefined);
        check('استئناف', 'مابيعملش دفعة جديدة مهما اتنادى',
          paymentsAfter[0].n, paymentsBefore[0].n);
        if (resumed1.status === 200) {
          const again = resumed1.body.data;
          // نفس الأرقام بالحرف — أي فرق هنا معناه تحويل رايح لمكان تاني.
          check('استئناف', 'نفس الحساب', again.recipient_address, first.recipient_address);
          check('استئناف', 'نفس المبلغ', again.amount_cents, first.amount_cents);
          check('استئناف', 'نفس رقم الطلب', again.reference_code, first.reference_code);
          check('استئناف', 'نداء تاني بيرجّع نفس الحاجة',
            resumed2.body?.data?.recipient_address, first.recipient_address);
        }
      }
    }

    // ═══ تسلسل صفحة الويب بالظبط ═══
    //
    // `apps/customer-web/src/app/orders/[id]/instapay/page.tsx` مابتعتمدش على كائن متمرَّر من
    // صفحة الحجز: بتعمل GET الأول، ولو ٤٠٤ بتبدأ التحويل، ولو الإنشاء رجع ٤٠٩ (تبويب تاني
    // سبقها) بترجع تقرا اللي كسب. الثلاث خطوات دي مالهاش اختبار في أي مكان تاني، وهي بالظبط
    // اللي بتخلّي `F5` أو تبويبين مفتوحين مايعملوش تحويلين على طلب واحد.
    console.log('\n═══ ٣ — تسلسل صفحة الويب: قراءة → إنشاء → تعارض → قراءة ═══');
    {
      const [order] = await h.q(
        `INSERT INTO orders (commission_rate_applied, order_number, customer_id, service_id, address_id,
           service_zone_id, order_status, payment_status, total_amount_cents, commissionable_base_cents,
           technician_earning_cents, booking_mode, settlement_policy_version)
         VALUES (20,$1,$2,$3,$4,$5,'pending_payment','unpaid',$6,$6,0,'individual',2)
         RETURNING id, order_number`,
        [`IPW-${h.runId}`.slice(0, 24), customer.profileId, catalog.service.id, customer.addressId,
         catalog.zone.id, PRICE_CENTS],
      );
      orderIds.push(order.id);

      // ① أول زيارة للصفحة: مفيش تحويل مفتوح → لازم ٤٠٤ بالظبط، مش ٥٠٠ ولا ٢٠٠ بجسم فاضي.
      // الصفحة بتفرّق بالكود ده تحديدًا بين «ابدأ تحويل» و«فيه غلط».
      const beforeStart = await h.api(`/orders/${order.id}/instapay-transfer`, { token: customer.token });
      check('ويب', 'القراءة قبل أي تحويل بترجّع ٤٠٤', beforeStart.status, 404,
        beforeStart.status !== 404 ? JSON.stringify(beforeStart.body?.error ?? '').slice(0, 200) : undefined);

      // ② الصفحة بتبدأ التحويل بمفتاح جديد.
      const created = await h.api(`/orders/${order.id}/pay-with-instapay`, {
        method: 'POST', token: customer.token,
        headers: { 'Idempotency-Key': `ipw-a-${h.runId}` },
      });
      check('ويب', 'الإنشاء من الصفحة عدّى', created.status, 201,
        created.status !== 201 ? JSON.stringify(created.body?.error ?? '').slice(0, 200) : undefined);

      // ③ تبويب تاني عمل نفس الحاجة بمفتاح **مختلف** — لازم يترفض، وإلا بقى فيه تحويلين على
      //    طلب واحد والعميل ممكن يحوّل مرتين.
      const secondTab = await h.api(`/orders/${order.id}/pay-with-instapay`, {
        method: 'POST', token: customer.token,
        headers: { 'Idempotency-Key': `ipw-b-${h.runId}` },
      });
      check('ويب', 'تبويب تاني مابيعملش تحويل تاني', secondTab.status, 409,
        secondTab.status !== 409 ? JSON.stringify(secondTab.body?.error ?? '').slice(0, 200) : undefined);

      const [count] = await h.q(
        `SELECT COUNT(*)::int AS n FROM payments WHERE order_id = $1 AND payment_method = 'instapay'`,
        [order.id]);
      check('ويب', 'دفعة InstaPay واحدة بس على الطلب', count.n, 1);

      // ④ التبويب الخاسر بيرجع يقرا — ولازم يلاقي نفس أرقام اللي كسب بالحرف.
      const afterConflict = await h.api(`/orders/${order.id}/instapay-transfer`, { token: customer.token });
      check('ويب', 'القراءة بعد التعارض بترد', afterConflict.status, 200,
        afterConflict.status !== 200 ? JSON.stringify(afterConflict.body?.error ?? '').slice(0, 200) : undefined);
      if (afterConflict.status === 200 && created.status === 201) {
        check('ويب', 'نفس الحساب في التبويبين',
          afterConflict.body.data.recipient_address, created.body.data.recipient_address);
        check('ويب', 'نفس رقم الطلب في التبويبين',
          afterConflict.body.data.reference_code, created.body.data.reference_code);
        check('ويب', 'نفس المبلغ في التبويبين',
          afterConflict.body.data.amount_cents, created.body.data.amount_cents);
      }

      // ⑤ «حوّلت الفلوس» — بيتسجّل في الباك-إند، ومابيأكّدش الدفع من نفسه.
      const claimed = await h.api(`/orders/${order.id}/confirm-instapay-transfer`, {
        method: 'POST', token: customer.token,
      });
      check('ويب', 'تسجيل «حوّلت» عدّى', claimed.status, 201,
        claimed.status !== 201 ? JSON.stringify(claimed.body?.error ?? '').slice(0, 200) : undefined);
      const [afterClaim] = await h.q(`SELECT payment_status FROM orders WHERE id = $1`, [order.id]);
      check('ويب', 'ادّعاء العميل مابيخلّيش الطلب مدفوع', afterClaim.payment_status, 'unpaid',
        'التأكيد النهائي من Finance بس');
    }

    console.log('\n═══ ٤ — العربون: افتراضي مقابل الدفع الكامل ═══');
    {
      await h.q(
        `UPDATE services SET deposit_required = true, deposit_percentage = $2, cash_allowed = true WHERE id = $1`,
        [catalog.service.id, DEPOSIT_PCT],
      );

      const createOrder = async (payFull) => {
        const res = await h.api('/orders', {
          method: 'POST', token: customer.token,
          headers: { 'Idempotency-Key': `ipd-dep-${payFull}-${h.runId}` },
          body: {
            service_id: catalog.service.id,
            address_id: customer.addressId,
            booking_mode: 'individual',
            prepayment_method: 'instapay',
            ...(payFull ? { pay_full_amount: true } : {}),
          },
        });
        return res;
      };

      const withDeposit = await createOrder(false);
      check('عربون', 'طلب بالعربون اتعمل', withDeposit.status, 201,
        withDeposit.status !== 201 ? JSON.stringify(withDeposit.body?.error ?? '').slice(0, 250) : undefined);
      if (withDeposit.status === 201) {
        const id = withDeposit.body.data.id;
        orderIds.push(id);
        const [row] = await h.q(
          `SELECT deposit_amount_cents, total_amount_cents FROM orders WHERE id = $1`, [id]);
        check('عربون', 'العربون اتثبّت بالنسبة الصح',
          Number(row.deposit_amount_cents),
          Math.round((Number(row.total_amount_cents) * DEPOSIT_PCT) / 100));
      }

      const full = await createOrder(true);
      check('عربون', 'طلب بالدفع الكامل اتعمل', full.status, 201,
        full.status !== 201 ? JSON.stringify(full.body?.error ?? '').slice(0, 250) : undefined);
      if (full.status === 201) {
        const id = full.body.data.id;
        orderIds.push(id);
        const [row] = await h.q(
          `SELECT deposit_amount_cents, total_amount_cents FROM orders WHERE id = $1`, [id]);
        // مفيش عربون مثبّت خالص — يعني كل المسار المالي بيتعامل معاه كطلب عادي.
        check('عربون', 'مفيش عربون على طلب الدفع الكامل', row.deposit_amount_cents, null);

        const transfer = await h.api(`/orders/${id}/pay-with-instapay`, {
          method: 'POST', token: customer.token,
          headers: { 'Idempotency-Key': `ipd-full-${h.runId}` },
        });
        check('عربون', 'التحويل على طلب الدفع الكامل عدّى', transfer.status, 201,
          transfer.status !== 201 ? JSON.stringify(transfer.body?.error ?? '').slice(0, 200) : undefined);
        if (transfer.status === 201) {
          check('عربون', 'المطلوب تحويله = الطلب كامل',
            transfer.body.data.amount_cents, Number(row.total_amount_cents));
        }
      }
    }
  } finally {
    for (const orderId of orderIds.filter(Boolean)) {
      try {
        execFileSync(process.execPath, [join(__dirname, 'clean-test-data.js'), '--order', orderId], { stdio: 'ignore' });
      } catch {
        console.warn(`⚠️  فشل تنظيف الطلب ${orderId}`);
      }
    }
    await h.cleanup();
    await h.close();
  }

  console.log('\n═══ النتيجة ═══');
  console.log(`${checks.filter((c) => c.ok).length}/${checks.length} فحص نضيف`);
  if (failures.length) {
    console.log(`\n🔴 ${failures.length} فحص وقع:`);
    for (const f of failures) {
      console.log(`   [${f.scenario}] ${f.name}: طلع ${JSON.stringify(f.actual)}، المفروض ${JSON.stringify(f.expected)}${f.note ? `\n      ${f.note}` : ''}`);
    }
    process.exit(1);
  }
  console.log('🟢 مسار InstaPay والعربون سليم.');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
