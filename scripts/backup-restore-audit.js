#!/usr/bin/env node
/**
 * **ج-١٠ — النسخ الاحتياطي واختبار الاسترجاع الفعلي**.
 *
 * البند ده اتكتب في القايمة بالصيغة دي عمدًا: «Backups **+ اختبار Restore فعلي**». السبب إن
 * الجزء الأول لوحده بلا قيمة — نص حوادث فقدان البيانات الحقيقية سببها نسخ كانت بتتاخد يوميًا
 * لشهور، وأول مرة حد جرّب يرجّعها كانت وقت الكارثة، ولقاها فاضية/تالفة/ناقصة.
 *
 * فالتدقيق ده **بيعمل كارثة حقيقية**: بيكتب بيانات معروفة، ياخد نسخة، **يمسح البيانات فعلاً**،
 * يرجّع النسخة في قاعدة منفصلة، ويقارن صف بصف. وبيقيس الزمن — عشان «هنرجّعها» يبقى معاها رقم.
 *
 * **آمن على قاعدة التطوير**: المسح بيتم على صفوف التشغيلة دي بس، والاسترجاع بيروح لقاعدة
 * جديدة مؤقتة بتتمسح في الآخر — القاعدة الشغّالة مابتتلمسش أبدًا.
 *
 *   node scripts/backup-restore-audit.js [--keep]
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('/home/user/portalSp/node_modules/pg');
const { LiveHarness, ROOT, DATABASE_URL } = require('./lib/live-harness');

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('bk');
const BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'baytak-backup-'));
let restoredDb = null;

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL },
    ...opts,
  });
}

/** آخر سطر من مخرجات السكريبت — الاتنين بيطبعوا النتيجة القابلة للاستخدام هناك. */
function lastLine(out) {
  const lines = String(out).trim().split('\n');
  return lines[lines.length - 1].trim();
}

async function run() {
  await h.connect();
  console.log(`\n=== ج-١٠: النسخ الاحتياطي والاسترجاع — تشغيلة ${h.runId} ===\n`);

  // ---- ن-١: بيانات معروفة نقدر نتعرّف عليها بعد الاسترجاع ----
  //
  // مجرد «الاسترجاع نجح» مش كفاية — لازم نتأكد إن **البيانات اللي كانت موجودة وقت النسخة**
  // رجعت بنفس القيم. عشان كده بنزرع بيانات لها بصمة فريدة.
  await h.seedCatalog();
  const customer = await h.makeCustomer('bk');
  const tech = await h.makeTechnician('bk');
  await h.fundWallet(customer.userId, 777_000);
  const marker = `بصمة-تدقيق-${h.runId}`;
  // **الطلب بيتعمل من الـAPI مش بـINSERT مباشر**: جدول `orders` عليه قيود أعمال حقيقية
  // (`chk_orders_earnings_policy_has_commission_rate_snapshot` وغيره) بتتملى من مسار الإنشاء.
  // الإدراج المباشر بيكسرها — وده في حد ذاته دليل إن القاعدة بتحمي نفسها، بس معناه إن التدقيق
  // لازم يعدّي من نفس باب العميل الحقيقي.
  const created = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      problem_description: marker,
    },
  });
  if (created.status !== 201) {
    h.record('ن-١ بيانات معروفة اتزرعت', false, `فشل إنشاء الطلب HTTP=${created.status}`);
    return finish();
  }
  const order = created.body.data;
  const [orderRow] = await h.q(`SELECT total_amount_cents FROM orders WHERE id = $1`, [order.id]);
  const expectedAmount = Number(orderRow.total_amount_cents);
  h.record(
    'ن-١ بيانات معروفة اتزرعت (طلب + مستخدمين + محفظة)',
    !!order.id,
    `طلب=${order.id.slice(0, 8)}… بمبلغ ${expectedAmount}`,
  );

  const before = (
    await h.q(`SELECT count(*)::int AS n FROM orders WHERE problem_description = $1`, [marker])
  )[0].n;

  // ---- ن-٢: أخد النسخة + التحقق منها ----
  const t0 = Date.now();
  let dumpPath;
  try {
    dumpPath = lastLine(sh('bash', [path.join(ROOT, 'scripts/backup-db.sh'), BACKUP_DIR]));
  } catch (err) {
    h.record('ن-٢/أ سكريبت النسخ اشتغل ونجح', false, String(err.message ?? err).slice(0, 200));
    return finish();
  }
  const backupSeconds = ((Date.now() - t0) / 1000).toFixed(1);
  h.record('ن-٢/أ سكريبت النسخ اشتغل ونجح', fs.existsSync(dumpPath), `${dumpPath} في ${backupSeconds}s`);

  // **الفحص اللي بيفرّق نسخة عن ملف**: أرشيف تالف أو فاضي بيعدّي على «الملف موجود» عادي.
  const manifestPath = `${dumpPath}.manifest.json`;
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  h.record(
    'ن-٢/ب النسخة اتحققت وقت أخدها (فهرس الأرشيف + الجداول الجوهرية موجودة)',
    !!manifest && manifest.tables_with_data > 20,
    manifest ? `${manifest.tables_with_data} جدول فيه بيانات، ${Math.round(manifest.size_bytes / 1024)}KB` : 'مفيش manifest ❗',
  );
  h.record(
    'ن-٢/ج النسخة لها بصمة sha256 (نقدر نكتشف تلف على القرص بعدين)',
    !!manifest?.sha256 && manifest.sha256 === sh('sha256sum', [dumpPath]).split(' ')[0],
    manifest?.sha256 ? `${manifest.sha256.slice(0, 16)}… مطابقة` : 'مفيش ❗',
  );

  // ---- ن-٣: الكارثة — مسح البيانات فعلاً ----
  //
  // ده الجزء اللي بيحوّل التدقيق من «شكلي» لحقيقي. من غير مسح فعلي، الاسترجاع ممكن يكون
  // بيقرا بيانات لسه موجودة أصلاً وإحنا مش واخدين بالنا.
  // `cascadeDelete` بيحل المراجع من `pg_constraint` — `DELETE` مباشر بيفشل على
  // `booking_funnel_events` وغيره. والفشل ده نفسه معلومة: الطلب الواحد ليه أثر في جداول تانية،
  // فالاسترجاع لازم يرجّعهم كلهم مش الصف الرئيسي بس (وده اللي `ن-٥/ج` و`ن-٥/د` بيقيسوه).
  await h.cascadeDelete('orders', [order.id]);
  const afterDelete = (
    await h.q(`SELECT count(*)::int AS n FROM orders WHERE problem_description = $1`, [marker])
  )[0].n;
  h.record(
    'ن-٣ الكارثة اتعملت فعلاً — البيانات اتمسحت من القاعدة الشغّالة',
    before > 0 && afterDelete === 0,
    `قبل=${before} بعد المسح=${afterDelete}`,
  );

  // ---- ن-٤: الاسترجاع ----
  const t1 = Date.now();
  let restoreOut;
  try {
    restoreOut = sh('bash', [path.join(ROOT, 'scripts/restore-db.sh'), dumpPath]);
  } catch (err) {
    h.record('ن-٤/أ الاسترجاع نجح', false, String(err.message ?? err).slice(0, 300));
    return finish();
  }
  const restoreSeconds = ((Date.now() - t1) / 1000).toFixed(1);
  restoredDb = lastLine(restoreOut);
  h.record(
    'ن-٤/أ الاسترجاع نجح في قاعدة منفصلة (القاعدة الشغّالة ما اتلمستش)',
    /^baytak_restore_\d+$/.test(restoredDb),
    `${restoredDb} في ${restoreSeconds}s`,
  );

  // **الافتراضي الآمن**: من غير `--target` الاسترجاع لازم **مايكتبش** فوق القاعدة الشغّالة.
  // الفحص ده بيمنع فئة الحادثة اللي بتحصل وقت الضغط: أمر استرجاع اتنفّذ من الذاكرة ومسح
  // الموجود.
  const stillDeleted = (
    await h.q(`SELECT count(*)::int AS n FROM orders WHERE problem_description = $1`, [marker])
  )[0].n;
  h.record(
    'ن-٤/ب الاسترجاع الافتراضي ما كتبش فوق القاعدة الشغّالة (أمان بالتصميم)',
    stillDeleted === 0,
    `صفوف البصمة في القاعدة الشغّالة لسه=${stillDeleted}`,
  );

  // ---- ن-٥: البيانات رجعت **صح** مش «الاسترجاع نجح» ----
  const restoredUrl = DATABASE_URL.replace(/\/[^/?]+(\?|$)/, `/${restoredDb}$1`);
  const rc = new Client({ connectionString: restoredUrl });
  await rc.connect();
  try {
    const { rows: found } = await rc.query(
      `SELECT id, order_status, total_amount_cents, customer_id FROM orders WHERE problem_description = $1`,
      [marker],
    );
    h.record(
      'ن-٥/أ الطلب الممسوح موجود في النسخة المسترجعة بنفس معرّفه',
      found.length === before && found[0]?.id === order.id,
      `لقينا ${found.length} صف، id مطابق=${found[0]?.id === order.id}`,
    );
    h.record(
      'ن-٥/ب وقيمه المالية رجعت بالظبط (مش صف فاضي بنفس المفتاح)',
      Number(found[0]?.total_amount_cents) === expectedAmount,
      `المبلغ=${found[0]?.total_amount_cents} (المتوقع ${expectedAmount})`,
    );

    // الجداول المرتبطة كمان — استرجاع بيرجّع جدول ويسيب مراجعه أسوأ من فشل صريح.
    const { rows: wallet } = await rc.query(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [
      customer.userId,
    ]);
    h.record(
      'ن-٥/ج المحفظة المرتبطة رجعت برصيدها (مش الجدول لوحده)',
      wallet[0]?.balance_cents === '777000' || Number(wallet[0]?.balance_cents) === 777_000,
      `الرصيد=${wallet[0]?.balance_cents}`,
    );
    const { rows: techRow } = await rc.query(`SELECT id FROM technician_profiles WHERE id = $1`, [tech.id]);
    h.record('ن-٥/د الفني رجع كمان', techRow.length === 1, `صفوف=${techRow.length}`);

    // **الـschema كامل مش البيانات بس**: استرجاع بلا فهارس بيرجّع البيانات ويسيب النظام بطيء
    // لدرجة التعطّل، واسترجاع بلا قيود بيسيبه يقبل بيانات فاسدة بعدين.
    const { rows: idx } = await rc.query(
      `SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const liveIdx = (await h.q(`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = 'public'`))[0].n;
    h.record(
      'ن-٥/هـ الفهارس رجعت كاملة (استرجاع بلا فهارس = نظام بطيء لدرجة التعطّل)',
      idx[0].n >= liveIdx * 0.98,
      `مسترجَع=${idx[0].n} / شغّال=${liveIdx}`,
    );
    const { rows: fks } = await rc.query(
      `SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f'`,
    );
    const liveFks = (await h.q(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f'`))[0].n;
    h.record(
      'ن-٥/و قيود المفاتيح الأجنبية رجعت (بلاها القاعدة بتقبل بيانات فاسدة بعدين)',
      fks[0].n >= liveFks * 0.98,
      `مسترجَع=${fks[0].n} / شغّال=${liveFks}`,
    );

    // ---- ن-٦: RTO — الرقم اللي لازم يكون في خطة الإطلاق ----
    const dbSizeMb = Number(
      (await h.q(`SELECT pg_database_size(current_database()) / 1024 / 1024 AS mb`))[0].mb,
    );
    h.record(
      'ن-٦ زمن الاسترجاع مقاس فعلاً (RTO برقم مش بوعد)',
      true,
      `القاعدة ${dbSizeMb}MB ⇒ نسخ ${backupSeconds}s، استرجاع ${restoreSeconds}s`,
    );
  } finally {
    await rc.end();
  }

  await finish();
}

async function finish() {
  // القاعدة المسترجَعة مؤقتة — سيبها بيملا القرص بعد كام تشغيلة.
  if (restoredDb && !KEEP) {
    try {
      const adminUrl = DATABASE_URL.replace(/\/[^/?]+(\?|$)/, '/postgres$1');
      const ac = new Client({ connectionString: adminUrl });
      await ac.connect();
      await ac.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [restoredDb],
      );
      await ac.query(`DROP DATABASE IF EXISTS "${restoredDb}"`);
      await ac.end();
    } catch (err) {
      console.log(`تنبيه: مامسحناش ${restoredDb} — ${String(err.message ?? err).slice(0, 120)}`);
    }
  }
  console.log(`\n--- الخلاصة ---`);
  console.log(`${h.results.length - h.failures.length}/${h.results.length} نجحوا`);
  if (h.failures.length) {
    console.log(`\n❌ محتاج تدخّل:`);
    for (const f of h.failures) console.log(`   • ${f.name}: ${f.detail}`);
  }
  if (!KEEP) {
    console.log(`\nتنظيف...`);
    await h.cleanup();
    fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
  } else {
    console.log(`\nالنسخ محفوظة في ${BACKUP_DIR}`);
  }
  await h.close();
  process.exit(h.failures.length ? 1 : 0);
}

run().catch(async (err) => {
  console.error('فشل:', err);
  await h.close();
  process.exit(2);
});
