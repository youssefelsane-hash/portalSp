import 'package:flutter/foundation.dart' show kReleaseMode;

// عنوان الباك-إند — Android emulator بيوصل للـ host عن طريق 10.0.2.2 مش localhost،
// iOS simulator بيقدر يستخدم localhost عادي. مفيش .env حقيقي في Flutter بدون حزمة إضافية
// (flutter_dotenv)، فمؤقتاً ثابت هنا لحد ما نحتاج فعلياً نفرّق بين بيئات (dev/staging/prod).
const String apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3000/api/v1',
);

/// Script 2 Part J (finding #50) — Fail-fast بدل ما نشحن إصدار Release حقيقي لمستخدم حقيقي وهو
/// لسه شايل عنوان Android emulator الافتراضي. القيمة دي مستحيل توصل لحاجة من جهاز حقيقي، ومفيش
/// أي رسالة خطأ واضحة توضّح السبب — العميل كان هيشوف بس "فشل الاتصال" بلا تفسير. بيتنادى مرة
/// واحدة من main() قبل runApp؛ صفر أثر على debug/profile (kReleaseMode بتبقى false هناك) — مفيش
/// تعديل مطلوب على دليل التشغيل المحلي.
/// `isRelease`/`url` قابلين للحقن عمدًا (افتراضيًا `kReleaseMode`/`apiBaseUrl` الحقيقيين) —
/// `kReleaseMode` ثابت وقت الترجمة ومش قابل نتحكم فيه من `flutter test`، فده الطريقة الوحيدة
/// لاختبار الفرعين (release/non-release) حقيقةً من غير build فعلي.
void assertProductionApiConfig({bool isRelease = kReleaseMode, String url = apiBaseUrl}) {
  if (!isRelease) return;
  final looksLikeDevDefault = url.contains('10.0.2.2') || url.contains('localhost') || url.contains('127.0.0.1');
  if (looksLikeDevDefault) {
    throw StateError(
      'إصدار Release لازم يُبنى مع --dart-define=API_BASE_URL=<دومين الباك-إند الحقيقي> — '
      'القيمة الحالية ($url) عنوان تطوير محلي، مش هيوصل لحاجة من جهاز حقيقي خالص.',
    );
  }
}
