import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

/// فتح رابط خارجي (موقع/تليفون/إيميل/واتساب/خرائط) **بطريقة مش بتفشل بصمت**.
///
/// ## البَقّة الحقيقية اللي وراه (بلاغ المالك 2026-09-11: «الفوتر في الأندرويد مابيفتحش أي حاجة»)
///
/// `url_launcher` على أندرويد **مابيرجّعش `false` أبدًا** لما الفتح يفشل — بيرمي
/// `PlatformException(code: 'ACTIVITY_NOT_FOUND')`. ده مش تخمين، ده مكتوب في كود الحزمة نفسها
/// (`url_launcher_android/lib/url_launcher_android.dart`):
///
/// ```dart
/// if (!succeeded) {
///   throw PlatformException(code: 'ACTIVITY_NOT_FOUND', message: '...');
/// }
/// ```
///
/// يعني كل النمط ده — وكان متكرر في ١١ مكان في التطبيقين:
///
/// ```dart
/// if (!await launchUrl(uri)) { showSnackBar('مقدرناش نفتح'); }   // ❌ فرع ميت على أندرويد
/// ```
///
/// **الـ`if` دي مستحيل تتنفّذ على أندرويد**. والأسوأ: الاستثناء بيتحصل جوّه `Future` محدش
/// بيستناه (`onTap: () => _openUrl(...)`) فبيروح لـ`FlutterError.onError` ويتطبع في اللوج
/// وخلاص — **المستخدم بيدوس وبيحصل ولا حاجة، بلا أي رسالة**. وده بالحرف وصف المالك:
/// «تدوس على أي حاجة ما بيفتحهاش، ما يعرفش ليه بصراحة».
///
/// ## القاعدة من دلوقتي
///
/// أي فتح رابط خارجي في التطبيق بيعدّي من هنا. مفيش `launchUrl` مباشرة في أي شاشة.
Future<bool> openExternalUrl(
  BuildContext context,
  Uri uri, {
  String? failureMessage,
}) async {
  var opened = false;
  Object? failure;

  try {
    opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (err) {
    // بنمسك `Object` مش `PlatformException` بس: `MissingPluginException` (منصة من غير
    // الإضافة) و`ArgumentError` (رابط مالوش scheme) بيوصلوا من هنا كمان، وكلهم نفس النتيجة
    // بالنسبة للمستخدم — الرابط مافتحش.
    failure = err;
    opened = false;
  }

  if (opened || !context.mounted) return opened;

  // الرسالة بتقول **الرابط نفسه**: من غيره المستخدم (والدعم) مش عارفين إيه اللي فشل أصلاً.
  final message = failureMessage ?? 'مقدرناش نفتح $uri';
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(failure == null ? message : '$message — مفيش تطبيق على جهازك يقدر يفتحه'),
    ),
  );
  return false;
}

/// فتح تطبيق الاتصال على رقم.
Future<bool> openPhoneDialer(BuildContext context, String phoneNumber) =>
    openExternalUrl(
      context,
      // بنشيل المسافات وعلامات التنسيق: `tel:` بتترمّز المسافة لـ`%20` وبعض تطبيقات الاتصال
      // بتفتح على رقم ناقص بسببها.
      Uri(scheme: 'tel', path: phoneNumber.replaceAll(RegExp(r'[\s()-]'), '')),
      failureMessage: 'تعذّر فتح تطبيق الاتصال',
    );

/// فتح تطبيق البريد على عنوان.
Future<bool> openEmailApp(BuildContext context, String email) => openExternalUrl(
      context,
      Uri(scheme: 'mailto', path: email),
      failureMessage: 'تعذّر فتح تطبيق البريد',
    );

/// رابط محادثة واتساب (`https://wa.me/<رقم دولي>`) من رقم مكتوب بأي شكل — `null` لو الرقم
/// مايصلحش (docs/08 §185).
///
/// نفس قاعدة السيرفر في `support-contact.controller.ts`: أرقام بس، ٦–٢٠ رقم، من غير `+`. بنقبل
/// الرقم زي ما الأدمن كاتبه في بيانات الجهة («+20 150 598 8990» أو «01505988990» أو بأرقام
/// عربية) عشان مايبقاش فيه رقم تاني مكتوب في الكود يختلف عن اللي في الفوتر.
Uri? whatsappChatUri(String? phone) {
  if (phone == null) return null;
  const eastern = '٠١٢٣٤٥٦٧٨٩';
  final buffer = StringBuffer();
  for (final char in phone.split('')) {
    final index = eastern.indexOf(char);
    if (index >= 0) {
      buffer.write(index);
    } else if (RegExp(r'[0-9]').hasMatch(char)) {
      buffer.write(char);
    }
  }
  var digits = buffer.toString();
  if (digits.startsWith('00')) digits = digits.substring(2);
  // رقم موبايل مصري محلي (01xxxxxxxxx) — واتساب محتاجه بكود الدولة.
  if (digits.length == 11 && digits.startsWith('01')) digits = '2$digits';
  if (!RegExp(r'^[0-9]{6,20}$').hasMatch(digits)) return null;
  return Uri.https('wa.me', '/$digits');
}

typedef ExternalUrlLauncher = Future<bool> Function(Uri uri, LaunchMode mode);

Future<bool> _defaultLauncher(Uri uri, LaunchMode mode) => launchUrl(uri, mode: mode);

/// فتح محادثة واتساب **بـfallback محترم** (docs/08 §185).
///
/// ١. تطبيق خارجي: لو واتساب متثبّت بيفتح المحادثة، ولو لأ رابط `wa.me` بيفتح في المتصفح (صفحة
///    واتساب الرسمية فيها «ابدأ المحادثة»/واتساب ويب).
/// ٢. لو مفيش تطبيق خارجي يفتحه: متصفح جوّه التطبيق.
/// ٣. لو ولا ده: رسالة فيها الرقم وزرار نسخ — مش «مقدرناش» وخلاص.
Future<bool> openWhatsappChat(
  BuildContext context,
  Uri chatUri, {
  ExternalUrlLauncher launcher = _defaultLauncher,
}) async {
  for (final mode in const [LaunchMode.externalApplication, LaunchMode.inAppBrowserView]) {
    try {
      if (await launcher(chatUri, mode)) return true;
    } catch (_) {
      // أندرويد بيرمي ACTIVITY_NOT_FOUND بدل ما يرجّع false (راجع أول الملف) — نجرّب اللي بعده.
    }
  }
  if (!context.mounted) return false;
  final number = '+${chatUri.pathSegments.isEmpty ? '' : chatUri.pathSegments.first}';
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text('مقدرناش نفتح واتساب على جهازك — رقمنا على واتساب: ${isolateLtr(number)}'),
      action: SnackBarAction(
        label: 'انسخ الرقم',
        onPressed: () => Clipboard.setData(ClipboardData(text: number)),
      ),
    ),
  );
  return false;
}

/// رقم تليفون جوّه جملة عربية بيتعرض LTR من غير ما يقلب ترتيب الجملة.
String isolateLtr(String value) => '\u2066$value\u2069';
