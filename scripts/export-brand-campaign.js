#!/usr/bin/env node

const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const hero = path.join(root, 'brand/campaigns/sanaa-tetammen-hero.png');
const logo = path.join(root, 'brand/logo/svg/osta-logo-white.svg');
const out = path.join(root, 'brand/campaigns');

function textLayer(width, height, variant) {
  const story = variant === 'story';
  const titleY = story ? 1390 : 1035;
  const bodyY = story ? 1490 : 1125;
  const ctaY = story ? 1650 : 1260;
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .ar { font-family: Tahoma, Arial, sans-serif; direction: rtl; }
      </style>
      <text class="ar" x="${width / 2}" y="${titleY}" text-anchor="middle" fill="#f7f2e8" font-size="${story ? 92 : 72}" font-weight="700">صنعة تِطَمِّن</text>
      <text class="ar" x="${width / 2}" y="${bodyY}" text-anchor="middle" fill="#dce8e4" font-size="${story ? 40 : 32}" font-weight="400">فنيين موثّقين · سعر واضح · متابعة من أول الطلب</text>
      <rect x="${width - (story ? 410 : 330)}" y="${ctaY - (story ? 63 : 52)}" width="${story ? 334 : 254}" height="${story ? 88 : 72}" rx="${story ? 44 : 36}" fill="#c66f45"/>
      <text class="ar" x="${width - (story ? 243 : 203)}" y="${ctaY}" text-anchor="middle" dominant-baseline="middle" fill="#fffdf8" font-size="${story ? 36 : 28}" font-weight="700">احجز دلوقتي</text>
    </svg>`);
}

async function makeFeed() {
  const width = 1080;
  const height = 1350;
  const photoHeight = 820;
  const photo = await sharp(hero).resize(width, photoHeight, { fit: 'cover', position: 'left' }).toBuffer();
  const logoBuffer = await sharp(logo).resize(250).toBuffer();
  await sharp({ create: { width, height, channels: 4, background: '#153f38' } })
    .composite([
      { input: photo, top: 0, left: 0 },
      { input: logoBuffer, top: 875, left: 754 },
      { input: textLayer(width, height, 'feed'), top: 0, left: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(out, 'sanaa-tetammen-feed.png'));
}

async function makeStory() {
  const width = 1080;
  const height = 1920;
  const photo = await sharp(hero).resize(width, height, { fit: 'cover', position: 'left' }).toBuffer();
  const overlay = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="35%" stop-color="#0d2d29" stop-opacity="0"/>
        <stop offset="78%" stop-color="#0d2d29" stop-opacity=".9"/>
        <stop offset="100%" stop-color="#0d2d29"/>
      </linearGradient></defs>
      <rect width="${width}" height="${height}" fill="url(#fade)"/>
    </svg>`);
  const logoBuffer = await sharp(logo).resize(310).toBuffer();
  await sharp(photo)
    .composite([
      { input: overlay, top: 0, left: 0 },
      { input: logoBuffer, top: 1130, left: 694 },
      { input: textLayer(width, height, 'story'), top: 0, left: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(out, 'sanaa-tetammen-story.png'));
}

Promise.all([makeFeed(), makeStory()])
  .then(() => console.log('Campaign feed and story exports are up to date.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
