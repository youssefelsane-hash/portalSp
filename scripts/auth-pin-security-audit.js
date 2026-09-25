#!/usr/bin/env node
/**
 * **تدقيق أمني على الدخول برمز** (ADR-0109) — الضوابط اللي لو واحد منهم اتكسر يبقى فيه
 * **استيلاء على حسابات** أو **تسريب بيانات شخصية بلا مصادقة**.
 *
 * ليه سكربت محفوظ مش تشغيلة عابرة: البَقّتين اللي اتلقطوا أول مرة (تعداد بالتوقيت، وتعداد
 * برسالة القفل) **الاتنين كانوا بيعدّوا كل الاختبارات الموجودة**، لأن الاختبارات كانت بتتأكد
 * من **نص الرسالة** وهو متطابق فعلاً — التسريب كان في **الزمن** و**كود الحالة**. أي اختبار
 * مايقيسهمش مش هيلاقيهم تاني.
 *
 * محتاج: API شغّال (`npm run start:dev` في `apps/api`) + Postgres + Redis.
 * التشغيل:  node scripts/auth-pin-security-audit.js
 *
 * ملحوظة على الـthrottle: التدقيق ده بيبعت محاولات كتير على نفس الرقم عن قصد، فلو الـAPI شغّال
 * بالسقوف الافتراضية بعض الفحوص بتترفض بـ429 قبل ما توصل للضابط اللي بتقيسه. شغّل الـAPI بـ
 * `THROTTLE_LIMIT=100000` وقت التدقيق ده — الضوابط المقيسة هنا **مستقلة عن الـthrottle** (القفل
 * على مستوى الحساب، والتوقيت، والصلاحيات)، والـthrottle نفسه متغطّى في `rate-limit-abuse-audit.js`.
 */
'use strict';

const { LiveHarness, LIVE_TEST_PIN } = require('./lib/live-harness');

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', B = '\x1b[1m', O = '\x1b[0m';
const h = new LiveHarness('sec');

const results = [];
function check(label, pass, detail = '') {
  results.push({ label, pass });
  console.log(`  ${pass ? `${G}✅` : `${R}❌`}${O} ${label}${detail ? `\n       ${D}${detail}${O}` : ''}`);
}

const WRONG_PIN = '905142';
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** نداء بيقيس الزمن كمان — الزمن هو المقياس في فحص التعداد. */
async function timed(pathname, body) {
  const t0 = process.hrtime.bigint();
  const res = await h.api(pathname, { method: 'POST', body });
  return { ...res, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

const msgOf = (res) => String(res.body?.error?.message ?? res.body?.message ?? '');

async function registerFresh(label) {
  const reg = await h.registerCustomerWithPin({ fullName: `تدقيق أمني ${label}` });
  if (reg.error) throw new Error(`تسجيل حساب الفحص فشل: ${reg.error}`);
  return reg;
}

async function main() {
  console.log(`\n${B}تدقيق أمني — الدخول برمز (ADR-0109) — تشغيلة ${h.runId}${O}\n`);
  await h.connect();
  try {
    // ═══ ١) تعداد الحسابات ═══════════════════════════════════════════════
    //
    // ADR-0109 §5 بيوعد إن الرد «ماتسرّبش وجود الحساب من عدمه». الوعد ده له **تلات قنوات**،
    // والرسالة الموحّدة بتغطّي واحدة بس.
    console.log(`${B}١) تعداد الحسابات${O}`);

    const a = await registerFresh('enum');
    const wrong = await timed('/auth/pin/login', { phone_number: a.phone, pin: WRONG_PIN });
    const unknown = await timed('/auth/pin/login', { phone_number: h.nextPhone(), pin: WRONG_PIN });

    check('نص الرسالة متطابق بين «رمز غلط» و«رقم مش مسجّل»',
      msgOf(wrong) === msgOf(unknown) && msgOf(wrong) !== '',
      `«${msgOf(wrong)}»`);
    check('كود الحالة متطابق', wrong.status === unknown.status, `${wrong.status} / ${unknown.status}`);

    // **القناة اللي كانت مكسورة**: الزمن. المسار بلا حساب كان بيرجع من غير ما يشغّل bcrypt
    // خالص (٦ مللي مقابل ٣٣١) — نداء واحد بساعة كان بيكشف وجود أي حساب.
    const knownMs = [], unknownMs = [];
    for (let i = 0; i < 5; i += 1) {
      const fresh = await registerFresh(`t${i}`);
      knownMs.push((await timed('/auth/pin/login', { phone_number: fresh.phone, pin: WRONG_PIN })).ms);
      unknownMs.push((await timed('/auth/pin/login', { phone_number: h.nextPhone(), pin: WRONG_PIN })).ms);
    }
    const kMed = median(knownMs), uMed = median(unknownMs);
    // العتبة ٤٠ مللي: تكلفة bcrypt ١٢ حوالي ٣٢٠ مللي، فالفرق الحقيقي لو الحماية غابت بيبقى
    // بمئات المللي مش بعشراتها. والضجيج الطبيعي بين نداءين متطابقين أقل من ٤٠ بكتير.
    check('زمن الرد مايفرّقش بين رقم مسجّل ومش مسجّل (مفيش تعداد بالتوقيت)',
      Math.abs(kMed - uMed) < 40,
      `مسجّل ${kMed.toFixed(0)} مللي · مش مسجّل ${uMed.toFixed(0)} مللي`);

    // القناة التالتة: القفل. حساب مقفول كان بيرد 429 والمش موجود 401.
    const locked = await registerFresh('lock');
    let lockedRes;
    for (let i = 0; i < 6; i += 1) {
      lockedRes = await h.api('/auth/pin/login', { method: 'POST', body: { phone_number: locked.phone, pin: WRONG_PIN } });
    }
    const unknownAfter = await h.api('/auth/pin/login', { method: 'POST', body: { phone_number: h.nextPhone(), pin: WRONG_PIN } });
    check('الحساب المقفول بيرد **زي** الرقم المش موجود بالحرف (مفيش تعداد بالقفل)',
      lockedRes.status === unknownAfter.status && msgOf(lockedRes) === msgOf(unknownAfter),
      `مقفول: ${lockedRes.status} «${msgOf(lockedRes)}» · مش موجود: ${unknownAfter.status}`);

    // ═══ ٢) القفل لسه شغّال فعلاً ═════════════════════════════════════════
    //
    // **أهم فحص في الملف**: إخفاء القفل عن المهاجم ماينفعش يبقى إلغاء للقفل. الرمز **الصح**
    // لازم يترفض طول مدة القفل، وإلا الحماية بقت ورق.
    console.log(`\n${B}٢) القفل بعد المحاولات${O}`);
    const st = await h.q(
      `SELECT pin_failed_attempts AS attempts, pin_locked_until AS until FROM users WHERE id = $1`,
      [locked.userId],
    );
    check('عدّاد المحاولات بيزيد فعلاً في القاعدة', Number(st[0]?.attempts) >= 5, `attempts=${st[0]?.attempts}`);
    check('القفل الزمني اتحط', st[0]?.until !== null, `locked_until=${st[0]?.until ?? 'NULL'}`);

    const correctWhileLocked = await h.api('/auth/pin/login', {
      method: 'POST', body: { phone_number: locked.phone, pin: LIVE_TEST_PIN },
    });
    check('**الرمز الصح بيترفض وإحنا مقفولين** — الإخفاء مش إلغاء',
      correctWhileLocked.status >= 400,
      `HTTP=${correctWhileLocked.status}`);

    // فك القفل بالإيد (بنقيس الضابط مش بننتظر دقيقة) والرمز الصح لازم يعدّي
    await h.q(`UPDATE users SET pin_locked_until = NULL, pin_failed_attempts = 0 WHERE id = $1`, [locked.userId]);
    const afterUnlock = await h.api('/auth/pin/login', {
      method: 'POST', body: { phone_number: locked.phone, pin: LIVE_TEST_PIN },
    });
    check('بعد فك القفل الرمز الصح بيعدّي (القفل مؤقت مش دائم)',
      afterUnlock.status === 200 && !!afterUnlock.body?.data?.access_token,
      `HTTP=${afterUnlock.status}`);

    const resetCounter = await h.q(`SELECT pin_failed_attempts AS attempts FROM users WHERE id = $1`, [locked.userId]);
    check('الدخول الناجح بيصفّر عدّاد المحاولات', Number(resetCounter[0]?.attempts) === 0,
      `attempts=${resetCounter[0]?.attempts}`);

    // ═══ ٣) الرمز نفسه مايتسربش ═══════════════════════════════════════════
    console.log(`\n${B}٣) الرمز مايظهرش في أي رد${O}`);
    const session = await h.api('/auth/pin/login', {
      method: 'POST', body: { phone_number: a.phone, pin: LIVE_TEST_PIN },
    });
    const token = session.body?.data?.access_token;
    check('الدخول بالرمز الصح نجح', !!token, `HTTP=${session.status}`);

    const me = await h.api('/auth/me', { token });
    const meRaw = JSON.stringify(me.body ?? {});
    check('`/auth/me` مافيهوش `pin_hash` ولا الرمز الخام',
      !meRaw.includes('pin_hash') && !meRaw.includes(LIVE_TEST_PIN),
      `pin_set=${me.body?.data?.pin_set}`);
    check('رد الدخول نفسه مافيهوش أي هاش', !JSON.stringify(session.body).includes('$2'));

    const [hashRow] = await h.q(`SELECT pin_hash FROM users WHERE id = $1`, [a.userId]);
    check('الرمز متخزّن مهشّر (bcrypt) مش خام',
      String(hashRow?.pin_hash ?? '').startsWith('$2') && !String(hashRow?.pin_hash).includes(LIVE_TEST_PIN));
    check('تكلفة الهاش ١٢ على الأقل — الرمز دائم و٦ أرقام فمساحته كلها قابلة للمسح',
      Number(String(hashRow?.pin_hash ?? '').split('$')[2] ?? 0) >= 12,
      `cost=${String(hashRow?.pin_hash ?? '').split('$')[2]}`);

    // ═══ ٤) تغيير الرمز ══════════════════════════════════════════════════
    console.log(`\n${B}٤) تعيين/تغيير الرمز${O}`);
    const noAuth = await h.api('/auth/pin', { method: 'POST', body: { pin: '628374' } });
    check('`POST /auth/pin` مرفوض بلا توكن', noAuth.status === 401, `HTTP=${noAuth.status}`);

    const noCurrent = await h.api('/auth/pin', { method: 'POST', token, body: { pin: '628374' } });
    check('**تغيير الرمز محتاج الرمز الحالي** — توكن مسروق لوحده مايقفلش صاحب الحساب برّه',
      noCurrent.status >= 400, `HTTP=${noCurrent.status} ${msgOf(noCurrent)}`);

    const wrongCurrent = await h.api('/auth/pin', {
      method: 'POST', token, body: { pin: '628374', current_pin: WRONG_PIN },
    });
    check('رمز حالي غلط بيترفض', wrongCurrent.status >= 400, `HTTP=${wrongCurrent.status}`);

    for (const [weak, why] of [['1111', 'كله نفس الرقم'], ['1234', 'تسلسل صاعد'], ['4321', 'تسلسل نازل']]) {
      const res = await h.api('/auth/pin', {
        method: 'POST', token, body: { pin: weak, current_pin: LIVE_TEST_PIN },
      });
      check(`رمز ضعيف مرفوض: ${weak} (${why})`, res.status >= 400, `HTTP=${res.status}`);
    }
    const tooShort = await h.api('/auth/pin', {
      method: 'POST', token, body: { pin: '12', current_pin: LIVE_TEST_PIN },
    });
    check('رمز أقصر من ٤ أرقام مرفوض', tooShort.status >= 400, `HTTP=${tooShort.status}`);

    // ═══ ٥) الاسترجاع الإداري ════════════════════════════════════════════
    console.log(`\n${B}٥) الاسترجاع الإداري${O}`);
    const victim = await registerFresh('victim');
    const plainAdmin = await h.makeAdmin();

    const noPerm = await h.api(`/admin/users/${victim.userId}/pin/reset`, { method: 'POST', token });
    check('عميل عادي مايقدرش يعمل reset لحساب حد تاني', noPerm.status === 403 || noPerm.status === 401,
      `HTTP=${noPerm.status}`);

    const noStepUp = await h.api(`/admin/users/${victim.userId}/pin/reset`, {
      method: 'POST', token: plainAdmin.token,
    });
    check('**الأدمن كمان محتاج step-up** — مجرد توكن أدمن مايكفيش لفك قفل حساب',
      noStepUp.status >= 400, `HTTP=${noStepUp.status} ${msgOf(noStepUp)}`);

    // ═══ ٦) استهلاك كود الاسترجاع ════════════════════════════════════════
    console.log(`\n${B}٦) كود الاسترجاع${O}`);
    const guess = await timed('/auth/pin/reset/redeem', {
      phone_number: victim.phone, reset_code: '0000000000', pin: '628374',
    });
    const guessUnknown = await timed('/auth/pin/reset/redeem', {
      phone_number: h.nextPhone(), reset_code: '0000000000', pin: '628374',
    });
    check('«كود غلط» و«مفيش استرجاع حاصل» نفس الرسالة بالحرف',
      msgOf(guess) === msgOf(guessUnknown), `«${msgOf(guess)}»`);
    check('ونفس الزمن كمان — مفيش تسريب لحساب بلا رمز مستنّي حد يحطّه',
      Math.abs(guess.ms - guessUnknown.ms) < 60,
      `${guess.ms.toFixed(0)} مللي / ${guessUnknown.ms.toFixed(0)} مللي`);

    // ═══ ٧) الـOTP مقفول فعلاً — صفر تكلفة SMS ════════════════════════════
    console.log(`\n${B}٧) مسار الـOTP مقفول${O}`);
    const otp = await h.api('/auth/otp/request', {
      method: 'POST', body: { phone_number: h.nextPhone(), purpose: 'login' },
    });
    check('`POST /auth/otp/request` مرفوض (410) — مفيش أي مسار بيوصل لمزوّد الـSMS',
      otp.status === 410, `HTTP=${otp.status} ${msgOf(otp)}`);

    // ═══ ٨) الجلسة ═══════════════════════════════════════════════════════
    console.log(`\n${B}٨) الجلسة والتوكن${O}`);
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    check('`amr` في التوكن بيقول `pin` — وسيلة الدخول مسجّلة في الجلسة',
      Array.isArray(payload.amr) && payload.amr.includes('pin'), JSON.stringify(payload.amr));
    check('التوكن مافيهوش الرمز ولا أي هاش',
      !JSON.stringify(payload).includes(LIVE_TEST_PIN) && !JSON.stringify(payload).includes('$2'));

    const refresh = session.body?.data?.refresh_token;
    const rotated = await h.api('/auth/refresh', { method: 'POST', body: { refresh_token: refresh } });
    check('تدوير التوكن بيطلّع refresh جديد',
      !!rotated.body?.data?.refresh_token && rotated.body.data.refresh_token !== refresh,
      `HTTP=${rotated.status}`);
    const replay = await h.api('/auth/refresh', { method: 'POST', body: { refresh_token: refresh } });
    check('**إعادة استخدام refresh قديم مرفوضة** — سرقة توكن قديم مابتفتحش جلسة',
      replay.status >= 400, `HTTP=${replay.status}`);

    // ═══ الخلاصة ═════════════════════════════════════════════════════════
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${B}الخلاصة:${O} ${results.length - failed.length}/${results.length} عدّوا`);
    if (failed.length) {
      console.log(`${R}الضوابط المكسورة:${O}`);
      failed.forEach((f) => console.log(`  • ${f.label}`));
    }
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    await h.cleanup();
    await h.close();
  }
}

main().catch((err) => {
  console.error(`${R}التدقيق نفسه فشل:${O}`, err);
  process.exitCode = 1;
});
