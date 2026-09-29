import 'package:flutter/material.dart';
import '../../core/external_links.dart';
import '../chat/chat_screen.dart';
import '../shell/site_info_repository.dart';
import '../shell/social_brand_mark.dart';
import 'support_tickets_screen.dart';
import 'support_contact_repository.dart';

/// رقم واتساب الدعم **من الإعدادات، مش من الكود** (docs/08 §185).
///
/// الأولوية: رقم واتساب خدمة العملاء (`support.whatsapp_number`) لو الأدمن مفعّله، وإلا رقم الدعم
/// في بيانات الجهة (`/legal-entity` → `support_phone`) — نفس الرقم اللي في الفوتر. كده تغيير
/// الرقم من لوحة الأدمن بيوصل للزرار من غير نسخة تطبيق جديدة، ومفيش رقم تاني مكتوب هنا يختلف.
Uri? resolveSupportWhatsappUri({SupportContact? contact, LegalEntityInfo? entity}) {
  final configured = contact != null && contact.enabled ? contact.whatsappUrl : null;
  final parsed = configured == null ? null : Uri.tryParse(configured);
  if (parsed != null && parsed.scheme == 'https' && parsed.host == 'wa.me') return parsed;
  return whatsappChatUri(entity?.supportPhone);
}

// "تواصل معنا" (docs/08 §22 بند 15-19) — نقطة وصول واحدة لكل طرق التواصل مع خدمة العملاء.
// تلات طرق ثابتة (تذاكر، شات، واتساب) + الاتصال لو الإدارة مفعّلاه. أي طريقة إعداداتها ناقصة
// مابتظهرش — مفيش زرار بيودّي لحتة فاضية.
class SupportContactScreen extends StatefulWidget {
  const SupportContactScreen({super.key, this.loadContact, this.loadEntity});

  /// للاختبارات بس — الافتراضي النداءات الحقيقية.
  final Future<SupportContact> Function()? loadContact;
  final Future<LegalEntityInfo> Function()? loadEntity;

  @override
  State<SupportContactScreen> createState() => _SupportContactScreenState();
}

class _SupportContactScreenState extends State<SupportContactScreen> {
  late final Future<({SupportContact? contact, LegalEntityInfo? entity})> _load = _fetch();

  Future<({SupportContact? contact, LegalEntityInfo? entity})> _fetch() async {
    // كل مصدر لوحده: فشل واحد (شبكة، إعداد ناقص) مايخفيش الطرق التانية.
    final results = await Future.wait<Object?>([
      (widget.loadContact ?? () => SupportContactRepository().fetch())()
          .then<Object?>((value) => value)
          .catchError((Object _) => null),
      (widget.loadEntity ?? () => SiteInfoRepository().legalEntity())()
          .then<Object?>((value) => value)
          .catchError((Object _) => null),
    ]);
    return (
      contact: results[0] as SupportContact?,
      entity: results[1] as LegalEntityInfo?,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('تواصل معنا')),
        body: FutureBuilder(
          future: _load,
          builder: (context, snapshot) {
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final contact = snapshot.data!.contact;
            final whatsapp = resolveSupportWhatsappUri(
              contact: contact,
              entity: snapshot.data!.entity,
            );
            final phone = contact != null && contact.enabled ? contact.phoneNumber : null;

            return ListView(
              padding: const EdgeInsets.all(20),
              children: [
                _ContactOption(
                  icon: const Icon(Icons.confirmation_number_outlined),
                  title: 'تذاكر الدعم',
                  subtitle: 'افتح تذكرة واحتفظ برقمها للمتابعة. شكاوى الطلبات تظل من صفحة الطلب.',
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const SupportTicketsScreen()),
                  ),
                ),
                const SizedBox(height: 12),
                _ContactOption(
                  icon: const Icon(Icons.chat_bubble_outline),
                  title: 'شات الدعم',
                  subtitle: 'ابعتلنا رسالة من هنا وهنرد عليك جوّه التطبيق.',
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const ChatScreen.support()),
                  ),
                ),
                if (whatsapp != null) ...[
                  const SizedBox(height: 12),
                  _ContactOption(
                    icon: const SocialBrandMark(network: 'whatsapp', size: 24),
                    title: 'تواصل معنا على واتساب',
                    subtitle: 'ابعتلنا رسالتك على واتساب',
                    onTap: () => openWhatsappChat(context, whatsapp),
                  ),
                ],
                if (phone != null) ...[
                  const SizedBox(height: 12),
                  _ContactOption(
                    icon: const Icon(Icons.call_outlined),
                    title: 'اتصل بينا',
                    subtitle: phone,
                    subtitleLtr: true,
                    onTap: () => openPhoneDialer(context, phone),
                  ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _ContactOption extends StatelessWidget {
  const _ContactOption({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.subtitleLtr = false,
  });

  final Widget icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool subtitleLtr;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              IconTheme(
                data: IconThemeData(color: theme.colorScheme.primary, size: 24),
                child: icon,
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(title, style: theme.textTheme.titleSmall),
                    const SizedBox(height: 4),
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: Text(
                        subtitle,
                        textDirection: subtitleLtr ? TextDirection.ltr : null,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_left, color: theme.colorScheme.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}
