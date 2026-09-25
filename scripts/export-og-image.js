#!/usr/bin/env node
/**
 * **صورة مشاركة الروابط (Open Graph)** — طلب مالك 2026-09-25: «لما حد يبعت لينك على واتساب،
 * يظهر كارت فيه صورة وعنوان مش لينك أزرق».
 *
 * بتتولّد من نفس الـbrand kit اللي في `brand/` (زي `export-brand-campaign.js` بالحرف) مش صورة
 * مرفوعة بالإيد: أي تعديل على اللوجو بيوصل للكارت بتشغيلة واحدة، ومفيش أصل يتيم بيقدم بصمت.
 *
 *   node scripts/export-og-image.js
 */
'use strict';

const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const logo = path.join(root, 'brand/logo/svg/osta-logo-white.svg');
const out = path.join(root, 'apps/customer-web/public/og.png');

// المقاس القياسي اللي واتساب/فيسبوك/تويتر بيقصّوا عليه (1.91:1). أي مقاس تاني بيتقص عشوائيًا.
const WIDTH = 1200;
const HEIGHT = 630;

function textLayer() {
  return Buffer.from(`
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#123b69"/>
          <stop offset="1" stop-color="#0b2444"/>
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
      <text x="${WIDTH / 2}" y="378" text-anchor="middle" fill="#fff8f2" font-size="64" font-weight="700" direction="rtl">صنعة تِطَمِّن</text>
      <text x="${WIDTH / 2}" y="446" text-anchor="middle" fill="#d9e7f7" font-size="32" direction="rtl">فنيين موثّقين · سعر واضح · متابعة من أول الطلب</text>
      <rect x="${WIDTH / 2 - 130}" y="500" width="260" height="66" rx="33" fill="#b54724"/>
      <text x="${WIDTH / 2}" y="543" text-anchor="middle" fill="#fff8f2" font-size="28" font-weight="700" direction="rtl">احجز دلوقتي</text>
    </svg>`);
}

async function main() {
  const logoBuffer = await sharp(logo, { density: 384 }).resize(420).toBuffer();
  await sharp(textLayer())
    .composite([{ input: logoBuffer, top: 150, left: Math.round((WIDTH - 420) / 2) }])
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`✅ ${path.relative(root, out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
