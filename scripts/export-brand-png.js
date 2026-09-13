#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const svgDir = path.join(root, 'brand/logo/svg');
const pngDir = path.join(root, 'brand/logo/png');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function render(svgName, output, width, height = width, opaque = false) {
  ensureDir(path.dirname(output));
  let image = sharp(path.join(svgDir, svgName), { density: 384 }).resize(width, height, { fit: 'contain' });
  if (opaque) image = image.flatten({ background: '#f7f2e8' }).removeAlpha();
  await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(output);
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

async function installAndroid(appPath, iconSvg) {
  const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [density, size] of Object.entries(sizes)) {
    await render(
      iconSvg,
      path.join(root, appPath, `android/app/src/main/res/mipmap-${density}/ic_launcher.png`),
      size,
      size,
      true,
    );
  }
}

function installAdaptiveAndroid(appPath, technician = false) {
  const res = path.join(root, appPath, 'android/app/src/main/res');
  const anydpi = path.join(res, 'mipmap-anydpi-v26');
  const drawable = path.join(res, 'drawable');
  const values = path.join(res, 'values');
  ensureDir(anydpi);
  ensureDir(drawable);
  ensureDir(values);

  const markPath =
    'M50,4 A46,46 0,1 1,49.99,4 Z M76.5,55.196 Q79.5,50 76.5,44.804 L67.75,29.648 Q64.75,24.452 58.75,24.452 L41.25,24.452 Q35.25,24.452 32.25,29.648 L23.5,44.804 Q20.5,50 23.5,55.196 L32.25,70.352 Q35.25,75.548 41.25,75.548 L58.75,75.548 Q64.75,75.548 67.75,70.352 Z';
  const hexPath =
    'M68,53.528 Q70,50 68,46.472 L59,30.884 Q57,27.42 53,27.42 L47,27.42 Q43,27.42 41,30.884 L32,46.472 Q30,50 32,53.528 L41,69.116 Q43,72.58 47,72.58 L53,72.58 Q57,72.58 59,69.116 Z';
  const foreground = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="140" android:viewportHeight="140">
  <group android:translateX="20" android:translateY="20">
    <path android:fillColor="${technician ? '#153F38' : '#F7F2E8'}" android:fillType="evenOdd" android:pathData="${markPath}"/>
    ${technician ? `<path android:fillColor="#C66F45" android:pathData="${hexPath}"/>` : ''}
  </group>
</vector>\n`;
  const monochrome = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="140" android:viewportHeight="140">
  <group android:translateX="20" android:translateY="20">
    <path android:fillColor="#000000" android:fillType="evenOdd" android:pathData="${markPath}"/>
  </group>
</vector>\n`;
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background"/>
  <foreground android:drawable="@drawable/ic_launcher_foreground"/>
  <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>
</adaptive-icon>\n`;
  fs.writeFileSync(path.join(drawable, 'ic_launcher_foreground.xml'), foreground);
  fs.writeFileSync(path.join(drawable, 'ic_launcher_monochrome.xml'), monochrome);
  fs.writeFileSync(path.join(anydpi, 'ic_launcher.xml'), adaptive);
  fs.writeFileSync(path.join(anydpi, 'ic_launcher_round.xml'), adaptive);
  fs.writeFileSync(
    path.join(values, 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">${technician ? '#F7F2E8' : '#153F38'}</color></resources>\n`,
  );
}

async function installIos(appPath, iconSvg) {
  const setDir = path.join(root, appPath, 'ios/Runner/Assets.xcassets/AppIcon.appiconset');
  const contents = JSON.parse(fs.readFileSync(path.join(setDir, 'Contents.json'), 'utf8'));
  const rendered = new Map();
  for (const image of contents.images) {
    if (!image.filename) continue;
    const size = Math.round(Number.parseFloat(image.size.split('x')[0]) * Number.parseFloat(image.scale));
    if (!rendered.has(image.filename)) {
      await render(iconSvg, path.join(setDir, image.filename), size, size, true);
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
    ['brand/logo/png/icon-1024.png', 'apps/admin/public/brand/osta-customer-icon.png'],
    ['brand/logo/png/icon-technician-1024.png', 'apps/admin/public/brand/osta-technician-icon.png'],
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
    installAndroid('apps/customer-app', 'osta-icon.svg'),
    installAndroid('apps/technician-app', 'osta-icon-technician.svg'),
    installIos('apps/customer-app', 'osta-icon.svg'),
    installIos('apps/technician-app', 'osta-icon-technician.svg'),
    installWebIcons(),
  ]);
  installAdaptiveAndroid('apps/customer-app');
  installAdaptiveAndroid('apps/technician-app', true);
  console.log('Brand PNGs and app icons are up to date.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
