# تشغيل تطبيقات Flutter على macOS محليًا

التطبيقان يعملان كبرامج macOS أصلية، وليس كصفحات Web. تسجيل الدخول وصلاحيات الباك-إند لا
تتغير؛ الذي يتم تجاوزه على سطح المكتب فقط هو فحص root/jailbreak والبصمة المخصصة للموبايل.

## المتطلبات

1. تثبيت Xcode الكامل من App Store، وليس Command Line Tools فقط.
2. تشغيل Xcode مرة واحدة وقبول الرخصة وتنزيل مكونات macOS المطلوبة.
3. تشغيل الـAPI محليًا على المنفذ `3000`.

## تطبيق العميل

```bash
cd ~/portalSp/apps/customer-app
flutter pub get
flutter run -d macos --dart-define=API_BASE_URL=http://127.0.0.1:3000/api/v1
```

## تطبيق الفني

افتح Terminal آخر:

```bash
cd ~/portalSp/apps/technician-app
flutter pub get
flutter run -d macos --dart-define=API_BASE_URL=http://127.0.0.1:3000/api/v1
```

نسخة macOS لها Bundle ID مستقل لكل تطبيق، لذلك يمكن فتح التطبيقين معًا. الـApp Sandbox يسمح
باتصال الـAPI والموقع، بينما حماية الجهاز تظل كما هي على Android وiOS.
