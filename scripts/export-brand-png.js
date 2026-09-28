#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const svgDir = path.join(root, 'brand/logo/svg');
const pngDir = path.join(root, 'brand/logo/png');
const mobileAppIcons = {
  customer: 'brand/logo/mobile-app-icons/osta-customer-app-icon.png',
  technician: 'brand/logo/mobile-app-icons/osta-technician-app-icon.png',
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function render(svgName, output, width, height = width, opaque = false) {
  ensureDir(path.dirname(output));
  let image = sharp(path.join(svgDir, svgName), { density: 384 }).resize(width, height, { fit: 'contain' });
  if (opaque) image = image.flatten({ background: '#fff8f2' }).removeAlpha();
  await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(output);
}

async function renderMobileIcon(source, output, size) {
  ensureDir(path.dirname(output));
  await sharp(path.join(root, source))
    .resize(size, size, { fit: 'fill' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(output);
}

async function renderBrandKit() {
  ensureDir(pngDir);
  for (const size of [16, 32, 48, 64, 72, 96, 120, 152, 180, 192, 512, 1024]) {
    await render('osta-icon.svg', path.join(pngDir, `icon-${size}.png`), size);
  }
  for (const size of [192, 512, 1024]) {
    await render('osta-icon-rounded.svg', path.join(pngDir, `icon-rounded-${size}.png`), size);
    await render('osta-icon-technician-rounded.svg', path.join(pngDir, `icon-technician-${size}.png`), size);
  }
  for (const size of [128, 512]) {
    await render('osta-mark.svg', path.join(pngDir, `mark-${size}.png`), size);
  }
  for (const width of [300, 600, 1200]) {
    await render('osta-logo.svg', path.join(pngDir, `logo-${width}.png`), width, Math.round((width * 60) / 210));
    await render(
      'osta-logo-white.svg',
      path.join(pngDir, `logo-white-${width}.png`),
      width,
      Math.round((width * 60) / 210),
    );
  }
  await render('osta-icon-foreground.svg', path.join(pngDir, 'icon-foreground-192.png'), 192);
  await render('osta-icon-foreground.svg', path.join(pngDir, 'icon-foreground-432.png'), 432);
}

async function installAndroid(appPath, iconSource) {
  const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [density, size] of Object.entries(sizes)) {
    await renderMobileIcon(iconSource, path.join(root, appPath, `android/app/src/main/res/mipmap-${density}/ic_launcher.png`), size);
  }
  await renderMobileIcon(iconSource, path.join(root, appPath, 'android/app/src/main/res/drawable-nodpi/osta_icon.png'), 1024);
}

function installAdaptiveAndroid(appPath) {
  const res = path.join(root, appPath, 'android/app/src/main/res');
  const anydpi = path.join(res, 'mipmap-anydpi-v26');
  ensureDir(anydpi);
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@android:color/transparent"/>
  <foreground android:drawable="@drawable/osta_icon"/>
</adaptive-icon>\n`;
  fs.writeFileSync(path.join(anydpi, 'ic_launcher.xml'), adaptive);
  fs.writeFileSync(path.join(anydpi, 'ic_launcher_round.xml'), adaptive);
}

async function installIos(appPath, iconSource) {
  const setDir = path.join(root, appPath, 'ios/Runner/Assets.xcassets/AppIcon.appiconset');
  const contents = JSON.parse(fs.readFileSync(path.join(setDir, 'Contents.json'), 'utf8'));
  const rendered = new Map();
  for (const image of contents.images) {
    if (!image.filename) continue;
    const size = Math.round(Number.parseFloat(image.size.split('x')[0]) * Number.parseFloat(image.scale));
    if (!rendered.has(image.filename)) {
      await renderMobileIcon(iconSource, path.join(setDir, image.filename), size);
      rendered.set(image.filename, size);
    }
  }
}

async function installWebIcons() {
  const customerIcon = fs.readFileSync(path.join(svgDir, 'osta-icon-rounded.svg'));
  const mark = fs.readFileSync(path.join(svgDir, 'osta-mark.svg'));
  const destinations = [
    ['apps/customer-web/src/app/icon.svg', customerIcon],
    ['apps/customer-web/public/icons/icon.svg', customerIcon],
    ['apps/admin/src/app/icon.svg', mark],
  ];
  for (const [relative, contents] of destinations) {
    const output = path.join(root, relative);
    ensureDir(path.dirname(output));
    fs.writeFileSync(output, contents);
  }

  const downloads = [
    ['brand/logo/png/logo-1200.png', 'apps/admin/public/brand/osta-logo.png'],
    ['brand/logo/png/mark-512.png', 'apps/admin/public/brand/osta-mark.png'],
    [mobileAppIcons.customer, 'apps/admin/public/brand/osta-customer-icon.png'],
    [mobileAppIcons.technician, 'apps/admin/public/brand/osta-technician-icon.png'],
    ['brand/campaigns/sanaa-tetammen-hero.png', 'apps/admin/public/brand/sanaa-tetammen-hero.png'],
    ['brand/campaigns/sanaa-tetammen-feed.png', 'apps/admin/public/brand/sanaa-tetammen-feed.png'],
    ['brand/campaigns/sanaa-tetammen-story.png', 'apps/admin/public/brand/sanaa-tetammen-story.png'],
  ];
  for (const [source, destination] of downloads) {
    const output = path.join(root, destination);
    ensureDir(path.dirname(output));
    fs.copyFileSync(path.join(root, source), output);
  }
}

async function main() {
  await renderBrandKit();
  await Promise.all([
    installAndroid('apps/customer-app', mobileAppIcons.customer),
    installAndroid('apps/technician-app', mobileAppIcons.technician),
    installIos('apps/customer-app', mobileAppIcons.customer),
    installIos('apps/technician-app', mobileAppIcons.technician),
    installWebIcons(),
  ]);
  installAdaptiveAndroid('apps/customer-app');
  installAdaptiveAndroid('apps/technician-app');
  console.log('Brand PNGs and app icons are up to date.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
