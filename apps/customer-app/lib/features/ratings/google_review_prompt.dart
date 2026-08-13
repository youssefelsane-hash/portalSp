import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

// طلب مراجعة Google (docs/10 بند 40) — كان مؤجّل عمدًا كـbacklog. بيظهر بس بعد تقييم عميل
// عالي فعلاً (الباك-إند هو اللي بيقرر should_prompt، مش الواجهة — راجع
// apps/api/src/modules/ratings/ratings.service.ts getGoogleReviewPrompt()).
Future<void> showGoogleReviewPromptDialog(BuildContext context, String reviewUrl) async {
  final open = await showDialog<bool>(
    context: context,
    builder: (context) => Directionality(
      textDirection: TextDirection.rtl,
      child: AlertDialog(
        title: const Text('سعيدين إنك عجبك الشغل! 🎉'),
        content: const Text('تحب تقيّمنا كمان على Google؟ بياخد نص دقيقة وبيفرق معانا كتير.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('لأ، شكراً')),
          FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('أكيد، يلا')),
        ],
      ),
    ),
  );
  if (open != true) return;

  // خارج التطبيق عمداً — مراجعة Google لازم تتعمل من حساب Google حقيقي للمستخدم، مش من
  // جوّه WebView مضمّن (نفس المشكلة اللي PortfolioLinkViewerScreen بيتفاداها بالعكس بالظبط:
  // هنا المطلوب الخروج للتطبيق/المتصفح الحقيقي، مش التضمين).
  final uri = Uri.tryParse(reviewUrl);
  if (uri != null) {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}
