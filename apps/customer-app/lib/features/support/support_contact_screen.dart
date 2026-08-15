import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../chat/chat_screen.dart';
import 'support_contact_repository.dart';

// "تواصل معنا" (docs/08 §22 بند 15-19) — نقطة وصول واحدة واضحة لكل طرق التواصل مع خدمة العملاء.
// قاعدة البساطة الصارمة (§22 بند 20-30): زرارين كبار بس (اتصال/واتساب) لو موجودين، من غير أي
// مصطلحات تقنية. لو الإدارة لسه ما ملّتش الأرقام (support.enabled=false)، بيوجّه لشات الدعم
// الموجود بالفعل بدل ما يعرض شاشة فاضية.
class SupportContactScreen extends StatelessWidget {
  const SupportContactScreen({super.key});

  Future<void> _call(String phone) => launchUrl(Uri(scheme: 'tel', path: phone));

  Future<void> _openWhatsapp(String url) => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('تواصل معنا')),
        body: FutureBuilder<SupportContact>(
          future: SupportContactRepository().fetch(),
          builder: (context, snapshot) {
            if (!snapshot.hasData && !snapshot.hasError) {
              return const Center(child: CircularProgressIndicator());
            }
            final contact = snapshot.data;
            final hasDirectContact =
                contact != null && contact.enabled && (contact.phoneNumber != null || contact.whatsappUrl != null);

            return ListView(
              padding: const EdgeInsets.all(20),
              children: [
                if (hasDirectContact) ...[
                  const Text(
                    'محتاج مساعدة؟ كلّمنا على طول',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 24),
                  if (contact.phoneNumber != null)
                    FilledButton.icon(
                      onPressed: () => _call(contact.phoneNumber!),
                      icon: const Icon(Icons.call),
                      label: const Text('اتصل بينا', style: TextStyle(fontSize: 16)),
                      style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 18)),
                    ),
                  if (contact.phoneNumber != null && contact.whatsappUrl != null) const SizedBox(height: 12),
                  if (contact.whatsappUrl != null)
                    FilledButton.icon(
                      onPressed: () => _openWhatsapp(contact.whatsappUrl!),
                      icon: const Icon(Icons.chat),
                      label: const Text('واتساب', style: TextStyle(fontSize: 16)),
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF25D366),
                        padding: const EdgeInsets.symmetric(vertical: 18),
                      ),
                    ),
                  const SizedBox(height: 24),
                  const Divider(),
                  const SizedBox(height: 12),
                ],
                const Text('أو ابعتلنا رسالة من هنا', textAlign: TextAlign.center),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const ChatScreen.support()),
                  ),
                  icon: const Icon(Icons.chat_bubble_outline),
                  label: const Text('شات الدعم'),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
