import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'models.dart';
import 'notifications_repository.dart';

// تفضيلات إشعارات المستخدم بالقناة (docs/10 بند 37) — كانت فجوة موثّقة صراحة: الشاشة دي كانت
// موجودة للعميل بس رغم إن الباك-إند عام لأي نوع مستخدم. نفس شاشة customer-app بالحرف.
// مستوى القناة بس (push/sms/whatsapp/email) — in_app مش موجودة هنا عمدًا (صندوق الإشعارات نفسه
// جوّه التطبيق، مفيش معنى تعطيله).
class NotificationPreferencesScreen extends StatefulWidget {
  const NotificationPreferencesScreen({super.key});

  @override
  State<NotificationPreferencesScreen> createState() => _NotificationPreferencesScreenState();
}

class _NotificationPreferencesScreenState extends State<NotificationPreferencesScreen> {
  late final NotificationsRepository _repository;
  List<NotificationChannelPreference>? _preferences;
  String? _error;
  final Set<String> _saving = {};

  @override
  void initState() {
    super.initState();
    _repository = NotificationsRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final preferences = await _repository.fetchPreferences();
      if (mounted) setState(() => _preferences = preferences);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
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
                ],
              ),
      ),
    );
  }
}
