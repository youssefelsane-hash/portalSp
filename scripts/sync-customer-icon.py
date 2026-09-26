"""Build every app/site icon from the approved customer-app icon (requires Pillow)."""

from pathlib import Path
from shutil import copyfile

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "apps/admin/public/brand/osta-customer-icon.png"
ICON = Image.open(SOURCE).convert("RGBA")
written = 0


def png(path: Path, size: int) -> None:
    global written
    path.parent.mkdir(parents=True, exist_ok=True)
    ICON.resize((size, size), Image.Resampling.LANCZOS).save(path, "PNG", optimize=True)
    written += 1


def ico(path: Path) -> None:
    global written
    path.parent.mkdir(parents=True, exist_ok=True)
    ICON.save(path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (256, 256)])
    written += 1


for app in ("customer-web", "admin"):
    app_dir = ROOT / "apps" / app / "src/app"
    png(app_dir / "icon.png", 512)
    png(app_dir / "apple-icon.png", 180)
    ico(app_dir / "favicon.ico")

for app in ("customer-app", "technician-app"):
    web_dir = ROOT / "apps" / app / "web"
    png(web_dir / "favicon.png", 64)
    for size in (192, 512):
        png(web_dir / f"icons/Icon-{size}.png", size)
        png(web_dir / f"icons/Icon-maskable-{size}.png", size)

    mac_icons = ROOT / "apps" / app / "macos/Runner/Assets.xcassets/AppIcon.appiconset"
    for size in (16, 32, 64, 128, 256, 512, 1024):
        png(mac_icons / f"app_icon_{size}.png", size)
    ico(ROOT / "apps" / app / "windows/runner/resources/app_icon.ico")

png(ROOT / "apps/admin/public/brand/osta-mark.png", 512)
png(ROOT / "apps/admin/public/brand/osta-technician-icon.png", 1024)
png(ROOT / "apps/customer-web/public/icons/icon-192.png", 192)
png(ROOT / "apps/customer-web/public/icons/icon-512.png", 512)

# The customer mobile launcher is already the approved icon. Give the technician
# launcher the exact same raster assets, without touching splash or app behavior.
customer_android = ROOT / "apps/customer-app/android/app/src/main/res"
technician_android = ROOT / "apps/technician-app/android/app/src/main/res"
android_files = [Path("drawable-nodpi/osta_icon.png")]
android_files += [Path(f"mipmap-{density}/ic_launcher.png") for density in ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi")]
for relative in android_files:
    copyfile(customer_android / relative, technician_android / relative)
    written += 1

customer_ios = ROOT / "apps/customer-app/ios/Runner/Assets.xcassets/AppIcon.appiconset"
technician_ios = ROOT / "apps/technician-app/ios/Runner/Assets.xcassets/AppIcon.appiconset"
for source in customer_ios.glob("*.png"):
    copyfile(source, technician_ios / source.name)
    written += 1

print(f"Synced {written} icon assets from {SOURCE.relative_to(ROOT)}")
