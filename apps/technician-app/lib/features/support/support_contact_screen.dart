import 'package:flutter/material.dart';
import '../../core/external_links.dart';
import '../internal_chat/internal_chat_list_screen.dart';
import 'support_contact_repository.dart';

// "اتصل بالدعم" (docs/08 §22 بند 15-19) — نقطة وصول واحدة واضحة لكل طرق التواصل مع خدمة العملاء
// (منفصلة عن "تواصل مع الإدارة" الموجودة أصلاً، اللي شات داخلي مع الإدارة مش رقم اتصال/واتساب).
// قاعدة البساطة الصارمة (§22 بند 20-30): زرارين كبار بس لو موجودين، من غير أي مصطلحات تقنية.
class SupportContactScreen extends StatelessWidget {
  const SupportContactScreen({super.key});

  Future<void> _call(BuildContext context, String phone) => openPhoneDialer(context, phone);

  Future<void> _openWhatsapp(BuildContext context, String url) =>
      openExternalUrl(context, Uri.parse(url), failureMessage: 'تعذّر فتح واتساب');

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('اتصل بالدعم')),
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
                      onPressed: () => _call(context, contact.phoneNumber!),
                      icon: const Icon(Icons.call),
                      label: const Text('اتصل بينا', style: TextStyle(fontSize: 16)),
                      style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 18)),
                    ),
                  if (contact.phoneNumber != null && contact.whatsappUrl != null) const SizedBox(height: 12),
                  if (contact.whatsappUrl != null)
                    FilledButton.icon(
                      onPressed: () => _openWhatsapp(context, contact.whatsappUrl!),
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
                const Text('أو ابعت رسالة للإدارة من هنا', textAlign: TextAlign.center),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const InternalChatListScreen()),
                  ),
                  icon: const Icon(Icons.chat_bubble_outline),
                  label: const Text('تواصل مع الإدارة'),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
