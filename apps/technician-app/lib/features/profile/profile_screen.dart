import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../onboarding/models.dart';
import '../onboarding/onboarding_repository.dart';

// بروفايلي — نوع الفني + "معاه مساعد؟" (docs/06 §3.7-§3.8) — كانت فجوة موثّقة صراحة: الباك-إند
// بيدعم طلب ربط مساعد بكود موظفه من زمان (الإدارة توافق بعد كده)، بس مفيش شاشة في التطبيق كانت
// بتعرض حالة الربط أو تسمح بطلبه أصلاً.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late final OnboardingRepository _repository;
  final _codeController = TextEditingController();
  TechnicianMe? _me;
  String? _error;
  bool _acting = false;

  @override
  void initState() {
    super.initState();
    _repository = OnboardingRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final me = await _repository.fetchMe();
      if (mounted) setState(() => _me = me);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _requestAssistant() async {
    final code = _codeController.text.trim();
    if (code.isEmpty) return;
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      await _repository.requestAssistant(code);
      _codeController.clear();
      await _load();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _removeAssistant() async {
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      await _repository.removeAssistant();
      await _load();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = _me;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('بروفايلي')),
        body: _error != null && me == null
            ? Center(child: Text(_error!))
            : me == null
                ? const Center(child: CircularProgressIndicator())
                : ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('كود الفني: ${me.technicianCode}', style: Theme.of(context).textTheme.titleMedium),
                              const SizedBox(height: 8),
                              Chip(label: Text(technicianTypeLabelsAr[me.technicianType] ?? me.technicianType)),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('معاه مساعد؟', style: Theme.of(context).textTheme.titleMedium),
                              const SizedBox(height: 8),
                              Text(
                                assistantLinkStatusLabelsAr[me.assistantLinkStatus] ?? me.assistantLinkStatus,
                              ),
                              if (_error != null) ...[
                                const SizedBox(height: 8),
                                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                              ],
                              const SizedBox(height: 12),
                              if (me.assistantLinkStatus == 'none') ...[
                                TextField(
                                  controller: _codeController,
                                  decoration: const InputDecoration(
                                    labelText: 'كود المساعد (مثال: TECH-000002)',
                                    border: OutlineInputBorder(),
                                  ),
                                ),
                                const SizedBox(height: 8),
                                FilledButton(
                                  onPressed: _acting ? null : _requestAssistant,
                                  child: _acting
                                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                                      : const Text('اطلب ربط مساعد'),
                                ),
                              ] else
                                OutlinedButton(
                                  onPressed: _acting ? null : _removeAssistant,
                                  child: _acting
                                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                                      : const Text('فك الربط'),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
      ),
    );
  }
}
