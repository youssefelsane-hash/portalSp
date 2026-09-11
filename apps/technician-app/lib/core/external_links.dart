import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// فتح رابط خارجي (موقع/تليفون/إيميل/واتساب/خرائط) **بطريقة مش بتفشل بصمت**.
///
/// ## البَقّة الحقيقية اللي وراه (بلاغ المالك 2026-09-11: «الروابط الخارجية مابتفتحش»)
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
