import 'package:flutter/foundation.dart' show kReleaseMode;

// عنوان الباك-إند — Android emulator بيوصل للـ host عن طريق 10.0.2.2 مش localhost،
// iOS simulator بيقدر يستخدم localhost عادي. مفيش .env حقيقي في Flutter بدون حزمة إضافية
// (flutter_dotenv)، فمؤقتاً ثابت هنا لحد ما نحتاج فعلياً نفرّق بين بيئات (dev/staging/prod).
const String apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3000/api/v1',
);

/// Script 2 Part J (finding #50) — Fail-fast بدل ما نشحن إصدار Release حقيقي لفني حقيقي وهو
/// لسه شايل عنوان Android emulator الافتراضي. القيمة دي مستحيل توصل لحاجة من جهاز حقيقي، ومفيش
/// أي رسالة خطأ واضحة توضّح السبب. بيتنادى مرة واحدة من main() قبل runApp؛ صفر أثر على
/// debug/profile (kReleaseMode بتبقى false هناك) — مفيش تعديل مطلوب على دليل التشغيل المحلي.
/// `isRelease`/`url` قابلين للحقن عمدًا (افتراضيًا `kReleaseMode`/`apiBaseUrl` الحقيقيين) —
/// `kReleaseMode` ثابت وقت الترجمة ومش قابل نتحكم فيه من `flutter test`، فده الطريقة الوحيدة
/// لاختبار الفرعين (release/non-release) حقيقةً من غير build فعلي.
void assertProductionApiConfig({bool isRelease = kReleaseMode, String url = apiBaseUrl, String? site}) {
  if (!isRelease) return;
  if (_isLocalDevHost(url)) {
    throw StateError(
      'إصدار Release لازم يُبنى مع --dart-define=API_BASE_URL=<دومين الباك-إند الحقيقي> — '
      'القيمة الحالية ($url) عنوان تطوير محلي، مش هيوصل لحاجة من جهاز حقيقي خالص.',
    );
  }
  // نفس الحماية لعنوان الموقع: الشروط والخصوصية وحذف الحساب كلهم روابط موقع، وGoogle Play
  // بيطلب نفس الروابط دي في Store Listing.
  final siteUrl = site ??
      (_siteBaseUrlOverride.isNotEmpty ? _stripTrailingSlash(_siteBaseUrlOverride) : deriveSiteBaseUrl(url));
  if (_isLocalDevHost(siteUrl)) {
    throw StateError(
      'إصدار Release لازم يُبنى مع --dart-define=SITE_BASE_URL=<دومين الموقع الحقيقي> — '
      'القيمة الحالية ($siteUrl) عنوان تطوير محلي، والروابط القانونية مش هتفتح.',
    );
  }
}

bool _isLocalDevHost(String url) =>
    url.contains('10.0.2.2') || url.contains('localhost') || url.contains('127.0.0.1');

/// عنوان **موقع العميل** (`ostahome.com`) — مش عنوان الـAPI.
///
/// **بَقّة حقيقية اتلقطت في بلاغ المالك 2026-09-11 «الفوتر مابيفتحش أي حاجة»**: الفوتر وشاشة
/// الشروط كانوا بيشتقّوا عنوان الموقع من `apiBaseUrl` بشيل `/api/v1` وخلاص. ده بيدّي
/// `http://10.0.2.2:3000` في التطوير و`https://api.ostahome.com` في الإنتاج — والاتنين
/// **الباك-إند مش الموقع**. يعني «شروط الاستخدام» كانت بتفتح `api.ostahome.com/legal/terms`
/// وترجّع 404 من NestJS. الموقع الحقيقي على `ostahome.com` (docs/31 §النطاقات) وفي التطوير على
/// المنفذ 3002.
///
/// الأولوية: `--dart-define=SITE_BASE_URL=...` صريح ← اشتقاق محسوب من `apiBaseUrl`.
/// الاشتقاق مقصود إنه **يخمّن صح في الحالتين المعروفتين بس** (بادئة `api.` والمنفذ 3000)، وأي
/// بيئة غير كده لازم تمرّر `SITE_BASE_URL` صراحة — عشان كده `assertProductionApiConfig` بيرفض
/// أي إصدار Release عنوان موقعه لسه محلي.
const String _siteBaseUrlOverride = String.fromEnvironment('SITE_BASE_URL');

String get siteBaseUrl =>
    _siteBaseUrlOverride.isNotEmpty ? _stripTrailingSlash(_siteBaseUrlOverride) : deriveSiteBaseUrl(apiBaseUrl);

String _stripTrailingSlash(String value) => value.endsWith('/') ? value.substring(0, value.length - 1) : value;

/// مكشوفة للاختبار عمدًا — `String.fromEnvironment` ثابت وقت الترجمة ومش قابل للحقن من
/// `flutter test`، فده الطريق الوحيد لاختبار الاشتقاق على مدخلات حقيقية.
String deriveSiteBaseUrl(String apiUrl) {
  final origin = _stripTrailingSlash(apiUrl.replaceFirst(RegExp(r'/api/v\d+/?$'), ''));
  final uri = Uri.tryParse(origin);
  if (uri == null || uri.host.isEmpty) return origin;

  // `api.ostahome.com` ← `ostahome.com`. مش بنشيل أي بادئة تانية: `staging-api.x` مثلاً
  // محتاج `SITE_BASE_URL` صريح، والتخمين فيه غلط أسوأ من عدم التخمين.
  final host = uri.host.startsWith('api.') ? uri.host.substring(4) : uri.host;

  // منفذ الباك-إند في التطوير (3000) ← منفذ `customer-web` (3002). نفس المنافذ المثبّتة في
  // `infra/docker` وسكربتات التشغيل.
  final port = uri.port == 3000 ? 3002 : uri.port;
  final hasDefaultPort = (uri.scheme == 'https' && port == 443) || (uri.scheme == 'http' && port == 80) || port == 0;

  return hasDefaultPort ? '${uri.scheme}://$host' : '${uri.scheme}://$host:$port';
}


/// مفتاح إيقاف التتبع اللحظي (`--dart-define=REALTIME_ENABLED=false`).
///
/// **ليه موجود**: `socket_io_client` بيفضل يجدول مؤقتات إعادة اتصال طول ما مفيش سيرفر
/// سوكيت — ومؤقت شغّال بعد تفكيك الشجرة بيوقّع اختبارات الواجهات كلها على `!timersPending`،
/// فيخبّي الأعطال الحقيقية وسطها. الافتراضي `true` (الإنتاج والتطوير)، والاختبارات بس هي
/// اللي بتقفله. مفيد كمان كمفتاح طوارئ لو بوابة السوكيت نفسها وقعت.
const bool kRealtimeEnabled = bool.fromEnvironment('REALTIME_ENABLED', defaultValue: true);
