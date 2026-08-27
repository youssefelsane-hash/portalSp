import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'models.dart';
import 'notifications_repository.dart';

// تفضيلات إشعارات المستخدم بالقناة (docs/10 بند 37) — كانت مؤجّلة عمدًا كـbacklog. مستوى
// القناة بس (push/sms/whatsapp/email) — in_app مش موجودة هنا عمدًا (صندوق الإشعارات نفسه
// جوّه التطبيق، مفيش معنى تعطيله).
class NotificationPreferencesScreen extends StatefulWidget {
  const NotificationPreferencesScreen({super.key});

  @override
  State<NotificationPreferencesScreen> createState() => _NotificationPreferencesScreenState();
}

class _NotificationPreferencesScreenState extends State<NotificationPreferencesScreen> {
  late final NotificationsRepository _repository;
  // بيتمسك مرة واحدة في initState — استخدام `context` بعد await مش آمن (الـwidget ممكن يكون
  // اتشال)، والمحلّل بيحذّر منه صراحةً.
  late final AuthRepository _auth;
  List<NotificationChannelPreference>? _preferences;
  String? _error;
  final Set<String> _saving = {};
  // ADR-0046 — إلغاء الاشتراك التسويقي: **مستقل تمامًا** عن قنوات إشعارات الطلبات فوق. العميل
  // يقفل الإعلانات من غير ما يفقد "الفني في الطريق".
  bool? _marketingOptOut;

  @override
  void initState() {
    super.initState();
    _auth = context.read<AuthRepository>();
    _repository = NotificationsRepository(_auth);
    _load();
  }

  Future<void> _load() async {
    try {
      final preferences = await _repository.fetchPreferences();
      if (mounted) setState(() => _preferences = preferences);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }

    // فشل تحميل تفضيل التسويق ما ينفعش يمنع الشاشة كلها — بيفضل null والقسم ما بيتعرضش.
    try {
      final data = await _auth.authedRequest('GET', '/customer/marketing-preference');
      if (mounted) setState(() => _marketingOptOut = data?['marketing_opt_out'] as bool? ?? false);
    } on ApiException {
      // متجاهَل عمدًا
    }
  }

  Future<void> _toggleMarketing(bool receiveOffers) async {
    final previous = _marketingOptOut;
    setState(() => _marketingOptOut = !receiveOffers);
    try {
      await _auth.authedRequest(
        'PATCH',
        '/customer/marketing-preference',
        body: {'marketing_opt_out': !receiveOffers},
      );
    } on ApiException catch (err) {
      // رجّع الحالة القديمة عشان الشاشة ما تكدبش على العميل لو الحفظ فشل.
      if (mounted) {
        setState(() => _marketingOptOut = previous);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
      }
    }
  }

  Future<void> _toggle(NotificationChannelPreference pref, bool value) async {
    setState(() => _saving.add(pref.channel));
    try {
      await _repository.updatePreference(pref.channel, value);
      if (mounted) {
        setState(() {
          _preferences = _preferences
              ?.map((p) => p.channel == pref.channel ? NotificationChannelPreference(channel: p.channel, isEnabled: value) : p)
              .toList();
        });
      }
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _saving.remove(pref.channel));
    }
  }

  @override
  Widget build(BuildContext context) {
    final preferences = _preferences;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('تفضيلات الإشعارات')),
        body: preferences == null
            ? (_error != null ? Center(child: Text(_error!)) : const Center(child: CircularProgressIndicator()))
            : ListView(
                children: [
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text('اختار القنوات اللي عايز تستقبل إشعارات عليها — إشعارات داخل التطبيق تفضل شغالة دايماً.'),
                  ),
                  for (final pref in preferences)
                    SwitchListTile(
                      title: Text(notificationChannelLabelsAr[pref.channel] ?? pref.channel),
                      value: pref.isEnabled,
                      onChanged: _saving.contains(pref.channel) ? null : (value) => _toggle(pref, value),
                    ),
                  if (_marketingOptOut != null) ...[
                    const Divider(height: 32),
                    SwitchListTile(
                      title: const Text('عروض وتذكيرات بالخدمات'),
                      subtitle: const Text(
                        'إشعارات بتفكّرك بالخدمات المتاحة. إقفالها مش هيأثر على إشعارات طلباتك خالص.',
                      ),
                      value: !_marketingOptOut!,
                      onChanged: _toggleMarketing,
                    ),
                  ],
                ],
              ),
      ),
    );
  }
}
