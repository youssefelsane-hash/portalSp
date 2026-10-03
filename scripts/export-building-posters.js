#!/usr/bin/env node
/**
 * بوسترات العمارات — حملة «في عمارتك» (docs/08 §194).
 *
 * المحتوى كله في `brand/campaigns/building-posters/config.json`؛ السكربت ده بيطلّع منه:
 *   out/posters.html          ملف واحد مكتفي بنفسه للمراجعة والتعديل السريع والطباعة من المتصفح
 *   out/png/<id>.png          معاينة A4 (150dpi) — للواتساب والمراجعة
 *   out/pdf/<id>-<size>.pdf   ملف المطبعة: مقاس القص + 3مم bleed من كل ناحية
 *
 *   node scripts/export-building-posters.js
 *   node scripts/export-building-posters.js --building-code BLD-2026-000123 --building-name "عمارة النخيل" --discount 10
 *   node scripts/export-building-posters.js --only plumbing,elevator --sizes A4,A3
 *   node scripts/export-building-posters.js --html-only
 *   node scripts/export-building-posters.js --config my-building.json --out /tmp/x   (نسخة إعدادات تانية)
 *
 * القرارات اللي مش باينة من الكود:
 * - كل المقاسات بوحدة `cqw` (نسبة من عرض البوستر)، فنفس التصميم بيتكبّر لأي مقاس من سلسلة A
 *   أو 50×70 من غير ما يتعاد رسمه. أقل مقاس منصوح بيه A4 — تحته الـQR بيصغر عن 25مم.
 * - الـQR بيتولّد محليًا بمكتبة `qrcode` (نفس اللي `modules/buildings` بيستخدمها) — مفيش خدمة
 *   خارجية تشوف لينكاتنا ولا تقدر تقع يوم الطباعة.
 * - شارات Google Play / App Store الرسمية مش مرسومة هنا: ليها قواعد استخدام صارمة. الاسم مكتوب
 *   نص تحت كل QR، ولو عايز الشارات الرسمية تتحط في مكانها من ملفات Google/Apple نفسهم.
 * - أي بيان ناقص (تليفون، واتساب، لينك ستور) بيتطبع كمكان متعلّم بوضوح، والـPDF بيطلع باسم
 *   `-DRAFT` — عشان مايتطبعش بوستر ناقص بالغلط.
 */
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');

const ROOT = path.resolve(__dirname, '..');
const CAMPAIGN = path.join(ROOT, 'brand/campaigns/building-posters');
const OUT = path.join(CAMPAIGN, 'out');
const FONTS = path.join(ROOT, 'brand/fonts/tajawal');

// مقاسات القص بالمللي — نسبة سلسلة A ثابتة (1:√2)، و50×70 قريبة منها كفاية للتخطيط المرن.
const SIZES = {
  A5: { w: 148, h: 210 },
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  '50x70': { w: 500, h: 700 },
};
const BLEED_MM = 3;

function parseArgs(argv) {
  const args = { sizes: ['A4', 'A3'], only: null, htmlOnly: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--building-code') args.buildingCode = next();
    else if (a === '--building-name') args.buildingName = next();
    else if (a === '--discount') args.discount = Number(next());
    else if (a === '--sizes') args.sizes = next().split(',').map((s) => s.trim());
    else if (a === '--only') args.only = next().split(',').map((s) => s.trim());
    else if (a === '--out') args.out = path.resolve(next());
    else if (a === '--config') args.config = path.resolve(next());
    else if (a === '--html-only') args.htmlOnly = true;
    else throw new Error(`مش فاهم الخيار: ${a}`);
  }
  for (const s of args.sizes) if (!SIZES[s]) throw new Error(`مقاس مش معروف: ${s} (المتاح: ${Object.keys(SIZES).join(', ')})`);
  return args;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const toArabicDigits = (s) => String(s).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

// ── الأيقونات: خط واحد بسُمك ثابت على شبكة 48، نفس روح الرمز (هندسي هادي، من غير تعبئة ولا ظلال).
const ICONS = {
  plumbing:
    '<path d="M7 17v10"/><path d="M7 22h15a8 8 0 0 1 8 8v2"/><path d="M17 22v-6"/><path d="M11.5 15.5h11"/>' +
    '<path d="M30 36.5c1.9 2.5 2.9 4.1 2.9 5.4a2.9 2.9 0 0 1-5.8 0c0-1.3 1-2.9 2.9-5.4z"/>',
  electric: '<path d="M27 5 13 27h10l-3 16 15-23H25z"/>',
  ironing:
    '<path d="M5 33c1-8 7-13.5 17-13.5h19V33z"/><path d="M22 19.5V15a2 2 0 0 1 2-2h12a4 4 0 0 1 4 4v2.5"/>' +
    '<path d="M13 40h.01M21 40h.01M29 40h.01"/>',
  cleaning:
    '<path d="M18 17h9v5l4.5 4.5V41a2 2 0 0 1-2 2H15.5a2 2 0 0 1-2-2V26.5L18 22z"/><path d="M18 17v-6h11l4 4h-6"/>' +
    '<path d="M19 31h7"/><path d="M39 7v7M35.5 10.5h7"/>',
  sparkle:
    '<path d="M22 8c1.2 7.6 4.4 10.8 12 12-7.6 1.2-10.8 4.4-12 12-1.2-7.6-4.4-10.8-12-12 7.6-1.2 10.8-4.4 12-12z"/>' +
    '<path d="M37 30c.6 3.4 2 4.8 5.4 5.4-3.4.6-4.8 2-5.4 5.4-.6-3.4-2-4.8-5.4-5.4 3.4-.6 4.8-2 5.4-5.4z"/>',
  broom:
    '<path d="M38 6 25 23"/><path d="M19.5 21.5 30 29.5 25.5 41c-6-.5-13.5-5-16.5-10.5z"/><path d="M15.5 33.5l6-7.5M20.5 37l5.5-7"/>',
  carpet:
    '<rect x="11" y="10" width="26" height="28" rx="1.5"/><path d="M24 17l6 7-6 7-6-7z"/>' +
    '<path d="M14 6v4M19 6v4M24 6v4M29 6v4M34 6v4M14 38v4M19 38v4M24 38v4M29 38v4M34 38v4"/>',
  shield: '<path d="M24 5 39 11v11c0 10-7 17.5-15 21C16 39.5 9 32 9 22V11z"/><path d="M17 24l5 5 9-10"/>',
  tag: '<path d="M6 25 24 7h16v16L22 41z"/><circle cx="32.5" cy="14.5" r="2.5"/>',
  route: '<path d="M24 43s12-11 12-21a12 12 0 0 0-24 0c0 10 12 21 12 21z"/><circle cx="24" cy="22" r="4.5"/>',
  globe:
    '<circle cx="24" cy="24" r="18"/><path d="M6 24h36"/><path d="M24 6c5 5 7.5 11 7.5 18S29 37 24 42c-5-5-7.5-11-7.5-18S19 11 24 6z"/>',
  phone:
    '<path d="M15 6h-4a3 3 0 0 0-3 3c0 18 13 31 31 31a3 3 0 0 0 3-3v-4l-8-4-4 4c-5-2-9-6-11-11l4-4z"/>',
  chat:
    '<path d="M24 6a18 18 0 0 0-15.6 27L6 42l9.3-2.4A18 18 0 1 0 24 6z"/><path d="M17.5 17.5c0 7 6 13 13 13l2.5-3.5-4-2-2 1.5c-2-1-4.5-3.5-5.5-5.5l1.5-2-2-4z"/>',
};
const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;

// الرمز نفسه (brand/logo/svg/osta-mark.svg): حلقة بفراغ سداسي ضلعه العلوي مسطّح. الخدمة بتتحط
// جوّه الفراغ — «الصنعة جوّه ختم الاعتماد»، نفس فكرة الشعار بالحرف بدل ما نخترع شكل جديد.
const MARK_PATH = fs
  .readFileSync(path.join(ROOT, 'brand/logo/svg/osta-mark.svg'), 'utf8')
  .match(/ d="([^"]+)"/)[1];
function heroMark(iconName) {
  return `<div class="mark" aria-hidden="true">
    <svg viewBox="0 0 100 100"><path d="${MARK_PATH}" fill="currentColor" fill-rule="evenodd"/></svg>
    <div class="mark-ic">${icon(iconName)}</div>
  </div>`;
}

function fontFaceCss() {
  const faces = [];
  for (const f of fs.readdirSync(FONTS).filter((n) => n.endsWith('.woff2')).sort()) {
    const [, weight, subset] = f.match(/tajawal-(\d+)-(\w+)\.woff2/);
    const range =
      subset === 'arabic'
        ? 'U+0600-06FF, U+0750-077F, U+08A0-08FF, U+200C-200E, U+2010-2011, U+FB50-FDFF, U+FE70-FEFF'
        : 'U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC, U+2122, U+2212';
    const b64 = fs.readFileSync(path.join(FONTS, f)).toString('base64');
    faces.push(
      `@font-face{font-family:'Tajawal';font-weight:${weight};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${range}}`,
    );
  }
  return faces.join('\n');
}

async function qrSvg(url) {
  // M = 15% تصحيح خطأ: كفاية لملصق ممكن يتخدش، ومن غير ما الكود يتكثّف لدرجة يصعب مسحه من بعيد.
  const svg = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#142235', light: '#0000' } });
  return svg.replace('<svg ', '<svg class="qr-svg" ');
}

function storeSlot(label, sub, svg) {
  return `<div class="store">
    <div class="qr ${svg ? '' : 'qr-empty'}" data-qr-slot="${esc(label)}" title="اضغط لتغيير صورة الـQR">
      ${svg ?? `<span class="qr-ph">QR<br>${esc(label)}</span>`}
    </div>
    <div class="store-label"><b>${esc(label)}</b><span>${esc(sub)}</span></div>
  </div>`;
}

const missing = (v) => !v || !String(v).trim();

// الموقع بقى تحت زرار التحميل (جزء من الدعوة نفسها)، فالسطر ده للتواصل بس — ولو التليفون والواتساب
// نفس الرقم (الشائع) بيتكتبوا مرة واحدة بدل ما ياخدوا عرض الشريط كله.
function contactRow(cfg) {
  const phone = cfg.contact.phone;
  const wa = cfg.contact.whatsapp;
  const digits = (v) => String(v ?? '').replace(/\D/g, '').replace(/^20/, '0');
  const val = (v) => `<span class="ct-v ${missing(v) ? 'todo' : ''}" dir="ltr" data-edit>${missing(v) ? 'لسه' : esc(v)}</span>`;
  const same = !missing(phone) && digits(phone) === digits(wa);
  const cells = same
    ? `<span class="ct">${icon('phone')}${icon('chat')}${val(phone)}<span class="ct-l">اتصال وواتساب</span></span>`
    : `<span class="ct">${icon('phone')}${val(phone)}</span><span class="ct">${icon('chat')}<span class="ct-l">واتساب</span>${val(wa)}</span>`;
  return `<div class="contacts"><span class="ct-h" data-edit>خدمة العملاء</span>${cells}</div>`;
}

function buildingTicket(cfg, { large = false } = {}) {
  const b = cfg.building;
  const code = missing(b.code) ? null : b.code;
  const pct = Number(b.discountPercent) || 0;
  if (!large && !code) return '';
  const codeHtml = code
    ? `<span class="tk-code" dir="ltr" data-edit>${esc(code)}</span>`
    : `<span class="tk-code todo" dir="ltr" data-edit>BLD-____-______</span>`;
  const pctHtml = pct > 0 ? `<span class="tk-pct"><b>${toArabicDigits(pct)}٪</b> خصم</span>` : '';
  const label = missing(b.name) ? 'كود عمارتك' : `كود <span class="tk-name" data-edit>${esc(b.name)}</span>`;
  return `<div class="ticket ${large ? 'ticket-lg' : ''}">
    <div class="tk-top"><span class="tk-label">${label}</span>${pctHtml}</div>
    ${codeHtml}
  </div>`;
}

// كود العمارة بياخد مكان «احجز من موبايلك» بدل ما يتضاف فوقه، فالشريط ارتفاعه ثابت بكود أو من غيره —
// وإلا البوستر اللي اتظبط على نسخة عامة كان هيتقص أول ما يتطبع لعمارة.
function band(cfg, qrs, { ticket = true } = {}) {
  const tk = ticket ? buildingTicket(cfg) : '';
  return `<footer class="band">
    <div class="band-row">
      <div class="cta">
        ${tk || '<span class="cta-k" data-edit>احجز من موبايلك</span>'}
        <span class="cta-pill">حمّل تطبيق ${esc(cfg.brand.nameAr)}</span>
        <span class="cta-site">${icon('globe')}<span class="cta-site-l" data-edit>أو من الموقع</span><b dir="ltr" data-edit>${esc(cfg.brand.siteDisplay)}</b></span>
      </div>
      <div class="stores">
        ${storeSlot('Google Play', 'أندرويد', qrs.googlePlay)}
        ${storeSlot('App Store', 'آيفون', qrs.appStore)}
      </div>
    </div>
    ${contactRow(cfg)}
  </footer>`;
}

const logoBlock = (ctx) => `<div class="logo">${ctx.logo}</div>`;

function intro(p) {
  return `<span class="eyebrow" data-edit>${esc(p.eyebrow)}</span>
    <h1 class="hl" data-edit>${p.headline.map(esc).join('<br>')}</h1>
    <p class="sub" data-edit>${esc(p.sub)}</p>`;
}

function proofs(cfg) {
  return `<ul class="proofs">${cfg.proofs.map((x) => `<li>${icon(x.icon)}<span data-edit>${esc(x.text)}</span></li>`).join('')}</ul>`;
}

const serviceLis = (cfg, keys) =>
  keys
    .map((k) => cfg.services[k])
    .filter(Boolean)
    .map((s) => `<li>${icon(s.icon)}<span data-edit>${esc(s.label)}</span></li>`)
    .join('');

// التخطيط الأساسي: الرسالة يمين، و«العمود» شمال — الرمز بالخدمة جوّاه وتحته باقي الخدمات، والعمود
// كحلي ونازل لحد الشريط اللي تحت فبيبان قطعة واحدة على شكل L. القايمة الجانبية بتاخد طول العمود
// كله، فإضافة خدمة أو اتنين مابتزقّش الرسالة.
function renderFocus(cfg, p, ctx) {
  const svc = cfg.services[p.service];
  return `<div class="body">
    <div class="main">
      ${logoBlock(ctx)}
      ${intro(p)}
      <ul class="items">${p.items.map((t) => `<li data-edit>${esc(t)}</li>`).join('')}</ul>
      ${proofs(cfg)}
    </div>
    <div class="spine">
      ${heroMark(svc.icon)}
      <aside class="side"><div class="side-t" data-edit>وكمان عندنا</div><ul>${serviceLis(cfg, p.side)}</ul></aside>
    </div>
  </div>
  ${band(cfg, ctx.qrs)}`;
}

// أسانسير: البوستر بيتقري وانت واقف ثواني، فالعمود مرسوم زي لوحة الأدوار — كل دور خطوة،
// والشاشة فوقه طالعة لآخر دور.
function renderLift(cfg, p, ctx) {
  const floors = p.steps
    .map((s, i) => `<li><span class="fl-n">${toArabicDigits(i + 1)}</span><span class="fl-t" data-edit>${esc(s)}</span></li>`)
    .reverse()
    .join('');
  return `<div class="body">
    <div class="main">
      ${logoBlock(ctx)}
      ${intro(p)}
      <ul class="grid">${serviceLis(cfg, p.grid)}</ul>
    </div>
    <div class="spine">
      <div class="lift-display" aria-hidden="true"><span class="arrow">▲</span><span class="lift-n">${toArabicDigits(p.steps.length)}</span></div>
      <aside class="side panel"><ol class="floors">${floors}</ol></aside>
    </div>
  </div>
  ${band(cfg, ctx.qrs)}`;
}

function renderCode(cfg, p, ctx) {
  const steps = p.steps.map((s, i) => `<li><span class="st-n">${toArabicDigits(i + 1)}</span><span data-edit>${esc(s)}</span></li>`).join('');
  return `<div class="body">
    <div class="main">
      ${logoBlock(ctx)}
      ${intro(p)}
      ${buildingTicket(cfg, { large: true })}
      <ol class="steps">${steps}</ol>
    </div>
    <div class="spine">
      ${heroMark('tag')}
      <aside class="side"><div class="side-t" data-edit>خدماتنا</div><ul>${serviceLis(cfg, p.grid)}</ul></aside>
    </div>
  </div>
  ${band(cfg, ctx.qrs, { ticket: false })}`;
}

const LAYOUTS = { focus: renderFocus, lift: renderLift, code: renderCode };

const CSS = `
:root{--navy:#123B69;--ivory:#FFF8F2;--copper:#B54724;--ink:#142235;--surface:#FFFAF6;--line:rgba(18,59,105,.14);--bleed:${BLEED_MM}mm}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#e9e4de;font-family:'Tajawal',sans-serif;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
ul,ol{list-style:none}
.sheet{position:relative;overflow:hidden;background:var(--ivory);width:calc(var(--w) + 2*var(--bleed));height:calc(var(--h) + 2*var(--bleed));flex:none}
/* نقشة سداسية باهتة جدًا — ملمس للورقة مش عنصر ينافس العنوان */
.sheet::before{content:"";position:absolute;inset:0;opacity:.05;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='97' viewBox='0 0 56 97'%3E%3Cpath d='M28 0 56 16v32L28 64 0 48V16zM28 64l28 16v32M28 64 0 80v32' fill='none' stroke='%23123B69' stroke-width='1.2'/%3E%3C/svg%3E");background-size:14mm auto}
.poster{position:absolute;inset:var(--bleed);container-type:inline-size;display:flex;flex-direction:column;direction:rtl}
.ic{width:1em;height:1em;flex:none}
.body{flex:1;min-height:0;display:flex;gap:4cqw;padding:6.5cqw 6.5cqw 0}
.main{flex:1;min-width:0;display:flex;flex-direction:column;padding-bottom:3.5cqw}
.spine{width:29.5cqw;flex:none;display:flex;flex-direction:column;gap:3cqw}
.logo svg{height:6.6cqw;width:auto;display:block}
.logo{margin-bottom:4cqw}
.mark{position:relative;width:29.5cqw;height:29.5cqw;color:var(--navy);flex:none}
.mark>svg{width:100%;height:100%;display:block}
.mark-ic{position:absolute;inset:0;display:grid;place-items:center;font-size:13cqw;color:var(--navy)}
.mark-ic .ic{stroke-width:2.3}
.eyebrow{align-self:flex-start;font-weight:700;font-size:3.2cqw;color:var(--navy);border:.35cqw solid var(--navy);border-radius:99em;padding:.6cqw 2.6cqw .3cqw;margin-bottom:2.6cqw;white-space:nowrap}
.hl{font-weight:900;font-size:7.5cqw;line-height:1.14;color:var(--navy);letter-spacing:-.01em;white-space:nowrap}
.sub{font-size:3.3cqw;line-height:1.55;margin-top:2.2cqw}
.items{margin-top:4cqw}
.items li{position:relative;font-size:3.2cqw;font-weight:700;padding:.75cqw 3.8cqw .65cqw 0;border-bottom:.2cqw solid var(--line);line-height:1.3}
.items li:last-child{border-bottom:0}
.items li::before{content:"";position:absolute;right:0;top:50%;width:1.9cqw;height:1.65cqw;transform:translateY(-60%);background:var(--navy);clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)}
.proofs{display:flex;gap:2cqw;margin-top:auto;padding-top:3cqw;border-top:.35cqw solid var(--navy)}
.proofs li{flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:.9cqw;font-size:2.7cqw;white-space:nowrap;font-weight:700;line-height:1.3;color:var(--navy)}
.proofs .ic{font-size:4.4cqw}
.side{flex:1;background:var(--navy);color:var(--ivory);border-radius:3cqw 3cqw 0 0;padding:3.6cqw 3cqw 2cqw}
.side-t{font-size:2.7cqw;font-weight:800;opacity:.7;margin-bottom:1.4cqw}
.side li{display:flex;align-items:center;gap:1.8cqw;font-size:2.9cqw;font-weight:700;padding:1.45cqw 0;border-bottom:.2cqw solid rgba(255,248,242,.14);line-height:1.25}
.side li:last-child{border-bottom:0}
.side .ic{font-size:4.6cqw;stroke-width:2.4}
.band{position:relative;margin:0 calc(-1*var(--bleed)) calc(-1*var(--bleed));padding:3.2cqw calc(6.5cqw + var(--bleed)) calc(3.4cqw + var(--bleed));background:var(--navy);color:var(--ivory)}
.band-row{display:flex;justify-content:space-between;align-items:center;gap:4cqw}
.cta{display:flex;flex-direction:column;align-items:flex-start;gap:1.7cqw;flex:1;min-width:0}
.cta-k{font-size:5.4cqw;font-weight:900;line-height:1.1}
.cta-pill{background:var(--copper);color:#fff;font-weight:800;font-size:3.4cqw;border-radius:99em;padding:1.5cqw 3.8cqw 1.1cqw}
.stores{display:flex;gap:3cqw}
.store{display:flex;flex-direction:column;align-items:center;gap:1.1cqw}
.qr{width:15.5cqw;height:15.5cqw;background:var(--ivory);border-radius:1.8cqw;padding:1.8cqw;display:grid;place-items:center;cursor:pointer;overflow:hidden}
.qr .qr-svg,.qr img{width:100%;height:100%;display:block;object-fit:contain}
.qr-empty{background:transparent;border:.35cqw dashed rgba(255,248,242,.55)}
.qr-ph{font-size:2.4cqw;font-weight:700;text-align:center;line-height:1.35;opacity:.75;direction:ltr}
.store-label{display:flex;flex-direction:column;align-items:center;line-height:1.15}
.store-label b{font-size:2.5cqw;font-weight:800;direction:ltr}
.store-label span{font-size:2.2cqw;opacity:.75}
.contacts{display:flex;align-items:center;gap:1.2cqw 4.5cqw;margin-top:2.4cqw;padding-top:2.2cqw;border-top:.2cqw solid rgba(255,248,242,.18);font-size:2.9cqw}
.ct{display:flex;align-items:center;gap:1.2cqw;white-space:nowrap}
.ct .ic{font-size:3.7cqw;opacity:.85}
.ct-l{opacity:.7}
.ct-v{font-weight:800}
.ct-h{font-size:2.6cqw;opacity:.7;margin-left:auto}
.cta-site{display:flex;align-items:center;gap:1.2cqw;font-size:2.7cqw;white-space:nowrap}
.cta-site .ic{font-size:3.4cqw;opacity:.85}
.cta-site-l{opacity:.75}
.cta-site b{font-size:3.6cqw;font-weight:800;letter-spacing:.01em}
.todo{color:#ffd9c9;background:rgba(181,71,36,.35);border-radius:.8cqw;padding:0 1.2cqw;font-weight:700}
.ticket{display:flex;flex-direction:column;align-items:stretch;gap:.6cqw;border:.35cqw dashed rgba(255,248,242,.6);border-radius:2cqw;padding:1.3cqw 2.4cqw 1.5cqw;align-self:stretch}
.tk-label{font-size:2.6cqw;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tk-name{font-weight:700}
.tk-code{font-size:4.2cqw;font-weight:900;letter-spacing:.04em;white-space:nowrap;text-align:left;line-height:1.15}
.tk-pct{font-size:2.7cqw;white-space:nowrap}
.tk-pct b{font-size:4cqw;font-weight:900}
/* أسانسير */
.lift-display{height:23cqw;display:flex;align-items:center;justify-content:center;gap:2.4cqw;background:var(--ink);color:#ffb08f;border-radius:3cqw;font-weight:900;font-size:13cqw;line-height:1;box-shadow:inset 0 0 0 .6cqw rgba(255,248,242,.07)}
.lift-display .arrow{font-size:5cqw}
.lift-display .lift-n{padding-top:1.5cqw}
.panel{display:flex;flex-direction:column;padding:4cqw 3cqw}
.floors{flex:1;display:flex;flex-direction:column;justify-content:space-around}
.floors li{display:flex;align-items:center;gap:2.2cqw;font-size:2.9cqw;font-weight:700;line-height:1.25}
.fl-n{width:7.4cqw;height:7.4cqw;border-radius:50%;border:.4cqw solid rgba(255,248,242,.75);display:grid;place-items:center;font-size:3.4cqw;font-weight:900;flex:none;padding-top:.5cqw}
.floors li:first-child .fl-n{background:var(--ivory);border-color:var(--ivory);color:var(--navy)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:2.2cqw;margin-top:4cqw}
.grid li{background:var(--surface);border:.25cqw solid var(--line);border-radius:2.2cqw;padding:2.2cqw 2cqw;display:flex;align-items:center;gap:1.6cqw;font-size:2.75cqw;font-weight:800;color:var(--navy);line-height:1.2;min-height:10cqw}
.grid .ic{font-size:5cqw}
/* سكان العمارة */
.tk-top{display:flex;justify-content:space-between;align-items:center;gap:2cqw}
.ticket-lg{background:var(--surface);color:var(--ink);border:.5cqw dashed var(--copper);border-radius:2.6cqw;padding:2cqw 3cqw 2.4cqw;margin-top:3.4cqw;gap:1.4cqw}
.ticket-lg .tk-label{font-size:3cqw;opacity:1;font-weight:700;color:var(--navy)}
.ticket-lg .tk-code{font-size:5cqw;color:var(--ink);text-align:left;line-height:1.2}
.ticket-lg .tk-code.todo{color:var(--copper);background:rgba(181,71,36,.1)}
.ticket-lg .tk-pct{font-size:3cqw;color:var(--copper);font-weight:700;white-space:nowrap}
.ticket-lg .tk-pct b{font-size:6.4cqw;vertical-align:-.12em}
.steps{display:flex;flex-direction:column;gap:1.3cqw;margin-top:auto}
.steps li{display:flex;align-items:center;gap:2.2cqw;font-size:3.1cqw;font-weight:700;line-height:1.3}
.st-n{width:6.4cqw;height:6.4cqw;border-radius:50%;background:var(--navy);color:var(--ivory);display:grid;place-items:center;font-weight:900;font-size:3.2cqw;padding-top:.4cqw;flex:none}
/* شاشة المراجعة */
.studio{display:flex;flex-direction:column;gap:18px;padding:16px;align-items:center}
.bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:center;background:#fff;border-radius:12px;padding:10px 14px;box-shadow:0 2px 12px rgba(0,0,0,.08);direction:rtl;font-size:14px}
.bar select,.bar button{font:inherit;padding:6px 10px;border-radius:8px;border:1px solid #ccd}
.bar button{background:var(--navy);color:#fff;border:0;cursor:pointer}
.bar .hint{color:#667;font-size:12.5px;max-width:520px}
.wall{display:flex;flex-wrap:wrap;gap:22px;justify-content:center}
.wall figure{display:flex;flex-direction:column;align-items:center;gap:8px}
.wall figcaption{font-size:13px;color:#556;direction:rtl}
.wall .sheet{zoom:var(--z,.5);box-shadow:0 6px 24px rgba(20,34,53,.18)}
body.editing [data-edit]{outline:1px dashed rgba(181,71,36,.6);outline-offset:2px;cursor:text}
.too-long{outline:2px solid #d92d20!important;outline-offset:3px}
.too-long::after{content:'العنوان أطول من مكانه — قصّره';position:absolute;font-size:2.4cqw;font-weight:700;color:#d92d20;white-space:nowrap}
@media print{
  html,body{background:none}
  .bar,.wall figcaption{display:none}
  .studio,.wall{display:block;padding:0}
  .wall .sheet{zoom:1;box-shadow:none;break-after:page}
  body.editing [data-edit]{outline:0}
  .too-long{outline:0!important}
}
`;

// العنوان سطرين ثابتين (nowrap) عشان الكسر يفضل في المكان اللي اتكتب فيه؛ لو سطر أطول من العمود
// الخط بيصغر لحد 6.4cqw بالكتير — تحت كده العنوان بيفقد وزنه، فالفحص بيوقف التصدير وبيطلب نص أقصر.
const FIT_JS = `window.__fitPosters=function(){document.querySelectorAll('.hl').forEach(function(h){
  h.style.fontSize='';var w=h.closest('.poster').getBoundingClientRect().width/100;
  var size=parseFloat(getComputedStyle(h).fontSize)/w;
  while(h.scrollWidth>h.clientWidth+0.5&&size>6.4){size-=0.1;h.style.fontSize=size+'cqw'}
  h.classList.toggle('too-long',h.scrollWidth>h.clientWidth+0.5);
})};`;

// شاشة المراجعة: تعديل نص سريع قبل الطباعة، تبديل صورة QR، واختيار المقاس — كله جوّه المتصفح.
// التعديل هنا للطبعة دي بس؛ التعديل الدايم مكانه config.json عشان مايضيعش.
const STUDIO_JS = `
(function(){
  var SIZES=${JSON.stringify(SIZES)};
  var root=document.documentElement, pageStyle=document.getElementById('page-size');
  function apply(size){
    var s=SIZES[size]; root.style.setProperty('--w',s.w+'mm'); root.style.setProperty('--h',s.h+'mm');
    pageStyle.textContent='@page{size:'+(s.w+${2 * BLEED_MM})+'mm '+(s.h+${2 * BLEED_MM})+'mm;margin:0}';
    var z=Math.min(1,340/((s.w+${2 * BLEED_MM})*3.7795)); root.style.setProperty('--z',z);
  }
  var sel=document.getElementById('size'); sel.onchange=function(){apply(sel.value);window.__fitPosters()}; apply(sel.value);
  document.fonts.ready.then(window.__fitPosters);
  document.addEventListener('input',function(e){if(e.target.closest('.hl'))window.__fitPosters()});
  document.getElementById('edit').onclick=function(){
    var on=document.body.classList.toggle('editing');
    document.querySelectorAll('[data-edit]').forEach(function(el){el.contentEditable=on});
    this.textContent=on?'خلّصت تعديل':'تعديل النصوص';
  };
  document.getElementById('print').onclick=function(){window.print()};
  var picker=document.createElement('input'); picker.type='file'; picker.accept='image/*'; var target=null;
  picker.onchange=function(){var f=picker.files[0]; if(!f||!target)return; var r=new FileReader();
    r.onload=function(){target.classList.remove('qr-empty'); target.innerHTML='<img alt="">'; target.firstChild.src=r.result; picker.value=''}; r.readAsDataURL(f)};
  document.addEventListener('click',function(e){var q=e.target.closest('[data-qr-slot]'); if(!q||!document.body.classList.contains('editing'))return; target=q; picker.click()});
})();`;

function pageHtml(cfg, sheetsHtml, { studio, size }) {
  const s = SIZES[size];
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>بوسترات العمارات — ${esc(cfg.brand.nameAr)}</title>
<style>${fontFaceCss()}</style><style>${CSS}</style>
<style id="page-size">@page{size:${s.w + 2 * BLEED_MM}mm ${s.h + 2 * BLEED_MM}mm;margin:0}</style>
<style>:root{--w:${s.w}mm;--h:${s.h}mm}</style>
<script>${FIT_JS}</script>
</head><body>
${
  studio
    ? `<div class="studio"><div class="bar">
  <label>المقاس <select id="size">${Object.keys(SIZES).map((k) => `<option ${k === size ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
  <button id="edit">تعديل النصوص</button><button id="print">طباعة / PDF</button>
  <span class="hint">في وضع التعديل: اضغط على أي نص وغيّره، واضغط على مربع QR عشان تحط صورته. التعديل هنا للطبعة دي بس — الدايم مكانه config.json. الطباعة بتطلع بـ3مم bleed.</span>
</div><div class="wall">${sheetsHtml}</div></div><script>${STUDIO_JS}</script>`
    : sheetsHtml
}
</body></html>`;
}

function draftReasons(cfg) {
  const r = [];
  if (missing(cfg.contact.phone)) r.push('رقم التليفون');
  if (missing(cfg.contact.whatsapp)) r.push('رقم الواتساب');
  if (missing(cfg.stores.googlePlay)) r.push('لينك Google Play');
  if (missing(cfg.stores.appStore)) r.push('لينك App Store');
  return r;
}

async function main() {
  const args = parseArgs(process.argv);
  const cfg = JSON.parse(fs.readFileSync(args.config ?? path.join(CAMPAIGN, 'config.json'), 'utf8'));
  if (args.buildingCode !== undefined) cfg.building.code = args.buildingCode;
  if (args.buildingName !== undefined) cfg.building.name = args.buildingName;
  if (args.discount !== undefined && !Number.isNaN(args.discount)) cfg.building.discountPercent = args.discount;
  if (!missing(cfg.building.code) && !/^BLD-\d{4}-\d{6}$/.test(cfg.building.code.trim())) {
    throw new Error(`كود العمارة "${cfg.building.code}" مش بشكل BLD-2026-000123 — انسخه من الأدمن ← العمائر بالظبط.`);
  }

  const posters = cfg.posters.filter((p) => !args.only || args.only.includes(p.id));
  for (const p of posters) {
    if (!LAYOUTS[p.layout]) throw new Error(`البوستر ${p.id}: layout مش معروف "${p.layout}"`);
    for (const k of [p.service, ...(p.side ?? []), ...(p.grid ?? [])].filter(Boolean)) {
      if (!cfg.services[k]) throw new Error(`البوستر ${p.id}: خدمة "${k}" مش موجودة في services`);
    }
  }

  const logo = fs.readFileSync(path.join(ROOT, 'brand/logo/svg/osta-logo-blue.svg'), 'utf8');
  const qrs = {
    googlePlay: missing(cfg.stores.googlePlay) ? null : await qrSvg(cfg.stores.googlePlay),
    appStore: missing(cfg.stores.appStore) ? null : await qrSvg(cfg.stores.appStore),
  };
  const ctx = { logo, qrs };
  const sheet = (p) => `<div class="sheet" data-id="${esc(p.id)}"><div class="poster">${LAYOUTS[p.layout](cfg, p, ctx)}</div></div>`;

  const out = args.out ?? OUT;
  fs.mkdirSync(out, { recursive: true });
  const studioHtml = pageHtml(
    cfg,
    posters.map((p) => `<figure>${sheet(p)}<figcaption>${esc(p.id)} — ${esc(p.eyebrow)}</figcaption></figure>`).join(''),
    { studio: true, size: 'A4' },
  );
  fs.writeFileSync(path.join(out, 'posters.html'), studioHtml);
  console.log(`✓ ${path.relative(ROOT, path.join(out, 'posters.html'))} (${Math.round(studioHtml.length / 1024)} KB)`);

  const draft = draftReasons(cfg);
  if (draft.length) console.log(`⚠️  ناقص: ${draft.join('، ')} — ملفات الـPDF هتطلع باسم -DRAFT ومكان الناقص متعلّم.`);
  if (args.htmlOnly) return;

  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  try {
    fs.mkdirSync(path.join(out, 'png'), { recursive: true });
    fs.mkdirSync(path.join(out, 'pdf'), { recursive: true });
    const suffix = draft.length ? '-DRAFT' : '';
    const tag = missing(cfg.building.code) ? '' : `-${cfg.building.code.trim()}`;
    for (const p of posters) {
      for (const size of args.sizes) {
        const s = SIZES[size];
        const page = await browser.newPage();
        await page.setContent(pageHtml(cfg, sheet(p), { studio: false, size }), { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready.then(() => window.__fitPosters()));
        const problems = await page.evaluate(() => {
          const out = [];
          const band = document.querySelector('.band').getBoundingClientRect();
          const sheet = document.querySelector('.sheet').getBoundingClientRect();
          if (Math.abs(band.bottom - sheet.bottom) > 1) out.push('الشريط اللي تحت مش قافل على حافة الورقة');
          const trim = document.querySelector('.poster').getBoundingClientRect();
          // هامش الأمان: أي نص أقرب من 4مم لحافة القص ممكن يتقص مع أقل انحراف في المطبعة.
          const safe = 4 * (trim.width / parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--w')));
          const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          for (const el of document.querySelectorAll('.poster *')) {
            if (el.classList.contains('band') || el.closest('svg')) continue;
            const r = el.getBoundingClientRect();
            if (!r.width && !r.height) continue;
            const label = (el.textContent || el.className || el.tagName).toString().trim().slice(0, 30);
            if (!el.closest('.band') && r.bottom > band.top + 0.5) out.push(`نازل تحت الشريط: «${label}»`);
            if ((hasOwnText(el) || el.classList.contains('qr')) && (r.left < trim.left + safe || r.right > trim.right - safe || r.bottom > trim.bottom - safe)) out.push(`قريب من حافة القص أو برّه: «${label}»`);
            if (hasOwnText(el) && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow === 'visible') out.push(`أعرض من مكانه: «${label}»`);
          }
          const main = document.querySelector('.main, .stack');
          const mr = main.getBoundingClientRect();
          for (const el of main.querySelectorAll('.hl, .items li, .proofs li, .sub, .grid li')) {
            const r = el.getBoundingClientRect();
            if (r.left < mr.left - 0.5 || r.right > mr.right + 0.5) out.push(`خارج العمود: «${el.textContent.trim().slice(0, 30)}»`);
          }
          return [...new Set(out)];
        });
        // أي نص بيتقص أو بيدخل تحت الشريط = بوستر بايظ في المطبعة، فبنوقف بدل ما نطلّع ملف.
        if (problems.length) throw new Error(`البوستر ${p.id} (${size}):\n  - ${problems.join('\n  - ')}\n  قصّر النص في config.json`);
        const base = `${p.id}${tag}`;
        await page.pdf({
          path: path.join(out, 'pdf', `${base}-${size}${suffix}.pdf`),
          width: `${s.w + 2 * BLEED_MM}mm`,
          height: `${s.h + 2 * BLEED_MM}mm`,
          printBackground: true,
          pageRanges: '1',
        });
        await page.close();
        if (size === args.sizes[0]) {
          // المعاينة على مقاس القص (من غير الـbleed) بـ150dpi — زي ما هتتشاف على الحيطة.
          const shot = await browser.newPage({ deviceScaleFactor: 150 / 96, viewport: { width: Math.ceil((s.w + 2 * BLEED_MM) * 3.7796), height: Math.ceil((s.h + 2 * BLEED_MM) * 3.7796) } });
          await shot.setContent(pageHtml(cfg, sheet(p), { studio: false, size }), { waitUntil: 'load' });
          await shot.evaluate(() => document.fonts.ready.then(() => window.__fitPosters()));
          await (await shot.$('.poster')).screenshot({ path: path.join(out, 'png', `${base}${suffix}.png`) });
          await shot.close();
        }
      }
      console.log(`✓ ${p.id}: ${args.sizes.join(' + ')}`);
    }
    // لوحة واحدة بكل البوسترات جنب بعض — للموافقة على الواتساب قبل الطباعة.
    const board = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 1 });
    await board.setContent(studioHtml, { waitUntil: 'load' });
    await board.evaluate(() => document.fonts.ready.then(() => window.__fitPosters()));
    await board.addStyleTag({ content: '.bar{display:none}.wall{max-width:1760px}.wall .sheet{zoom:.5!important}' });
    await (await board.$('.wall')).screenshot({ path: path.join(out, `overview${tag}${suffix}.png`) });
    await board.close();
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
