import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../core/api_config.dart';

/// يوحّد روابط الصور ويحفظها في كاش القرص الخاص بـ`cached_network_image`.
///
/// الكاش الافتراضي للحزمة يبقى بين فتحات التطبيق، بعكس `Image.network` الذي يعتمد غالباً
/// على الذاكرة فقط. لذلك فتح الصفحة الرئيسية مرة ثانية لا يعيد تنزيل صور الفئات والنصائح.
String resolveCachedRemoteImageUrl(String value) {
  final url = value.trim();
  return url.startsWith('http://') || url.startsWith('https://')
      ? url
      : resolveApiAssetUrl(url);
}

ImageProvider<Object> cachedRemoteImageProvider(
  String value, {
  int? maxWidth,
}) => CachedNetworkImageProvider(
  resolveCachedRemoteImageUrl(value),
  maxWidth: maxWidth,
);

/// يجهّز الصور المرئية مبكراً من دون فتح عشرات الاتصالات في اللحظة نفسها.
///
/// أول فتح يحتاج تنزيل الصور من الشبكة بطبيعته، لكن بعدها الصور نفسها تُقرأ من كاش القرص.
/// الدفعات الصغيرة تضمن أن شاشة البداية لا تنافس تحميل بيانات الحساب والكتالوج.
Future<void> precacheRemoteImages(
  BuildContext context,
  Iterable<String?> values, {
  double? logicalWidth,
  int concurrency = 3,
}) async {
  if (!context.mounted) return;
  final urls = values
      .whereType<String>()
      .map((value) => value.trim())
      .where((value) => value.isNotEmpty)
      .toSet()
      .toList(growable: false);
  if (urls.isEmpty) return;

  final devicePixelRatio = MediaQuery.maybeDevicePixelRatioOf(context) ?? 1.0;
  final maxWidth = logicalWidth == null
      ? null
      : (logicalWidth * devicePixelRatio).round();

  for (var index = 0; index < urls.length; index += concurrency) {
    if (!context.mounted) return;
    final batch = urls.skip(index).take(concurrency);
    await Future.wait(
      batch.map((url) async {
        try {
          await precacheImage(
            cachedRemoteImageProvider(url, maxWidth: maxWidth),
            context,
          );
        } catch (_) {
          // كل موضع عرض لديه fallback؛ فشل رابط إداري واحد لا يعطّل باقي الشاشة.
        }
      }),
    );
  }
}
