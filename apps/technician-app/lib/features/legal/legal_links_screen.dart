import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/api_config.dart';

/// الشروط والسياسات (بوابة P0-1 في docs/23).
///
/// **بتفتح صفحات الويب مش نسخة مكررة من النص**: النص القانوني مصدره الوحيد
/// `apps/customer-web/src/lib/legal-content.ts`، ونسخه هنا كان هيخلق نسختين لازم يتزامنوا يدويًا
/// — وأول ما يختلفوا، واحد فيهم بيبقى كذب في مستند قانوني. Google Play بيطلب نفس الروابط دي في
/// Store Listing كمان، فاستخدامها هنا بيضمن إن اللي المستخدم بيشوفه هو نفسه اللي المتجر بيشوفه.
class LegalLinksScreen extends StatelessWidget {
  const LegalLinksScreen({super.key});

  /// الموقع مشتق من عنوان الـAPI — نفس المبدأ المتّبع في `resolveApiAssetUrl`، فمفيش دومين
  /// تاني مكتوب في الكود لازم يتحدّث لوحده لما البيئة تتغيّر.
  static String get _siteOrigin => apiBaseUrl.replaceFirst(RegExp(r'/api/v1/?$'), '');

  Future<void> _open(BuildContext context, String path) async {
    final uri = Uri.parse('$_siteOrigin$path');
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('مقدرناش نفتح $uri')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('الشروط والسياسات')),
      body: ListView(
        children: [
          ListTile(
            leading: const Icon(Icons.gavel_outlined),
            title: const Text('شروط الاستخدام'),
            trailing: const Icon(Icons.open_in_new, size: 18),
            onTap: () => _open(context, '/legal/terms'),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.privacy_tip_outlined),
            title: const Text('سياسة الخصوصية'),
            trailing: const Icon(Icons.open_in_new, size: 18),
            onTap: () => _open(context, '/legal/privacy'),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.delete_outline),
            title: const Text('كيف أحذف حسابي؟'),
            trailing: const Icon(Icons.open_in_new, size: 18),
            onTap: () => _open(context, '/legal/account-deletion'),
          ),
        ],
      ),
    );
  }
}
