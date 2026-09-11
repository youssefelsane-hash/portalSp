import 'package:flutter/material.dart';
import '../../core/api_config.dart';
import '../../core/external_links.dart';

/// الشروط والسياسات (بوابة P0-1 في docs/23).
///
/// **بتفتح صفحات الويب مش نسخة مكررة من النص**: النص القانوني مصدره الوحيد
/// `apps/customer-web/src/lib/legal-content.ts`، ونسخه هنا كان هيخلق نسختين لازم يتزامنوا يدويًا
/// — وأول ما يختلفوا، واحد فيهم بيبقى كذب في مستند قانوني. Google Play بيطلب نفس الروابط دي في
/// Store Listing كمان، فاستخدامها هنا بيضمن إن اللي المستخدم بيشوفه هو نفسه اللي المتجر بيشوفه.
class LegalLinksScreen extends StatelessWidget {
  const LegalLinksScreen({super.key});

  /// عنوان الموقع من `api_config.dart` — **مش** اشتقاق محلي من `apiBaseUrl`.
  ///
  /// الاشتقاق المحلي القديم كان بيدّي عنوان الباك-إند نفسه، فـ«شروط الاستخدام» كانت بتفتح
  /// `api.ostahome.com/legal/terms` وترجّع 404. تفاصيل السبب الكامل في `siteBaseUrl`.
  static String get _siteOrigin => siteBaseUrl;

  Future<void> _open(BuildContext context, String path) async {
    await openExternalUrl(context, Uri.parse('$_siteOrigin$path'));
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
