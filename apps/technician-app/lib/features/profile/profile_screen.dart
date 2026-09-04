import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../core/biometric_auth_service.dart';
import '../onboarding/models.dart';
import '../onboarding/onboarding_repository.dart';
import '../preferred_crew/preferred_crew_screen.dart';
import '../earnings/monthly_statement_screen.dart';
import '../../design/confirm_dialog.dart';

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
  bool _biometricAvailable = false;
  bool _biometricEnabled = false;
  bool _uploadingPhoto = false;
  bool _deletingAccount = false;

  @override
  void initState() {
    super.initState();
    _repository = OnboardingRepository(context.read<AuthRepository>());
    _load();
    _loadBiometricState();
  }

  Future<void> _loadBiometricState() async {
    final available = await BiometricAuthService.isAvailable();
    final enabled = await BiometricAuthService.isEnabled();
    if (mounted) {
      setState(() {
        _biometricAvailable = available;
        _biometricEnabled = enabled;
      });
    }
  }

  // docs/08 §17.22 — "بصمة اختياري على جهاز موثوق": تفعيلها بيتطلب تأكيد هوية فوري بالبصمة
  // نفسها (مش مجرد تبديل switch)، عشان نتأكد إن اللي بيفعّلها فعلاً هو صاحب البصمة المسجّلة على
  // الجهاز، مش حد لاقي الموبايل مفتوح وقلب الإعداد. تعطيلها مايحتاجش تأكيد (رجوع لمسار OTP بس).
  Future<void> _toggleBiometric(bool wantEnabled) async {
    if (!wantEnabled) {
      await BiometricAuthService.setEnabled(false);
      if (mounted) setState(() => _biometricEnabled = false);
      return;
    }
    final confirmed = await BiometricAuthService.authenticate(
      reason: 'أكّد بصمتك عشان تفعّل الدخول بالبصمة',
    );
    if (!confirmed) return;
    await BiometricAuthService.setEnabled(true);
    if (mounted) setState(() => _biometricEnabled = true);
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

  // ADR-0031 (بلاغ مالك 2026-08-21) — كانت بَقّة حقيقية: مفيش شاشة في التطبيق كانت بترفع/تعرض
  // صورة شخصية أصلاً بعد اعتماد الفني (OnboardingScreen بتتفتح مرة واحدة قبل الاعتماد بس، راجع
  // main.dart's _VerificationGate). نفس document_type=photo القديم، نفس endpoint، بس متاح دلوقتي
  // من هنا كمان — الصورة بتظهر فورًا (GET /technician/me بترجّع آخر صورة رفعها الفني نفسه، بغض
  // النظر عن حالة المراجعة)، وبعد اعتماد الأدمن ليها بتبقى هي الأفتار اللي العميل بيشوفه.
  Future<void> _changePhoto() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 85,
    );
    if (picked == null) return;
    setState(() {
      _uploadingPhoto = true;
      _error = null;
    });
    try {
      final bytes = await picked.readAsBytes();
      await _repository.uploadDocument(
        documentType: 'photo',
        fileBytes: bytes,
        filename: picked.name,
      );
      await _load();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _uploadingPhoto = false);
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

  /// مسار حذف الحساب موجود داخل إدارة الحساب بدل القائمة الرئيسية، مع تأكيد نهائي واضح.
  Future<void> _confirmDeleteAccount() async {
    final confirmed = await showConfirmDialog(
      context,
      title: 'حذف الحساب نهائيًا؟',
      message:
          'هيتم حذف اسمك ورقمك وبريدك ومستندات هويتك من النظام، ومش هتقدر ترجع للحساب ده تاني.\n\n'
          'سجلات الطلبات ومستحقاتك المالية بتتحفظ لمدة يفرضها القانون، بس من غير بياناتك الشخصية.\n\n'
          'لو عندك رصيد في المحفظة أو طلب لسه شغال، لازم تخلّصهم الأول.',
      confirmLabel: 'احذف حسابي',
      destructive: true,
    );
    if (!confirmed || !mounted) return;

    setState(() => _deletingAccount = true);
    try {
      await context.read<AuthRepository>().deleteAccount();
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.message)));
      setState(() => _deletingAccount = false);
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
                  Center(
                    child: Column(
                      children: [
                        Stack(
                          children: [
                            CircleAvatar(
                              radius: 48,
                              backgroundImage: me.avatarUrl != null
                                  ? NetworkImage(me.avatarUrl!)
                                  : null,
                              child: me.avatarUrl == null
                                  ? const Icon(Icons.person, size: 48)
                                  : null,
                            ),
                            Positioned(
                              bottom: 0,
                              left: 0,
                              child: CircleAvatar(
                                radius: 16,
                                child: _uploadingPhoto
                                    ? const SizedBox(
                                        width: 16,
                                        height: 16,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                        ),
                                      )
                                    : IconButton(
                                        icon: const Icon(
                                          Icons.camera_alt_outlined,
                                          size: 16,
                                        ),
                                        onPressed: _changePhoto,
                                        tooltip: 'غيّر صورتك',
                                      ),
                              ),
                            ),
                          ],
                        ),
                        if (me.verificationStatus == 'approved')
                          const Padding(
                            padding: EdgeInsets.only(top: 4),
                            child: Text(
                              'صورتك المعتمدة هي اللي العميل بيشوفها — أي صورة جديدة تترفع لازم اعتماد الأدمن الأول',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontSize: 11,
                                color: Colors.grey,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'كود الفني: ${me.technicianCode}',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          Chip(
                            label: Text(
                              technicianTypeLabelsAr[me.technicianType] ??
                                  me.technicianType,
                            ),
                          ),
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
                          Text(
                            'معاه مساعد؟',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            assistantLinkStatusLabelsAr[me
                                    .assistantLinkStatus] ??
                                me.assistantLinkStatus,
                          ),
                          if (_error != null) ...[
                            const SizedBox(height: 8),
                            Text(
                              _error!,
                              style: TextStyle(
                                color: Theme.of(context).colorScheme.error,
                              ),
                            ),
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
                                  ? const SizedBox(
                                      width: 20,
                                      height: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    )
                                  : const Text('اطلب ربط مساعد'),
                            ),
                          ] else
                            OutlinedButton(
                              onPressed: _acting ? null : _removeAssistant,
                              child: _acting
                                  ? const SizedBox(
                                      width: 20,
                                      height: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    )
                                  : const Text('فك الربط'),
                            ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  // «مستحقاتي» (docs/08 §61.1، ADR-0038) — حساب الشهر الحالي والشهور
                  // السابقة، محسوب أوتوماتيك من الباك-إند. متحطّ فوق باقي البنود عمدًا:
                  // ده أكتر سؤال بيشغل الفني.
                  Card(
                    child: ListTile(
                      leading: const Icon(
                        Icons.account_balance_wallet_outlined,
                      ),
                      title: const Text('مستحقاتي'),
                      subtitle: const Text(
                        'حساب الشهر الحالي والشهور اللي فاتت، بتفاصيل كل شغلانة',
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => MonthlyStatementScreen(
                            auth: context.read<AuthRepository>(),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.groups_outlined),
                      title: const Text('الفريق المفضّل'),
                      subtitle: const Text(
                        'زمايلك المفضّلين لتجنيد طلبات "اعتماد" — أولوية بعد فريقك الدائم',
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => const PreferredCrewScreen(),
                        ),
                      ),
                    ),
                  ),
                  if (_biometricAvailable) ...[
                    const SizedBox(height: 16),
                    Card(
                      child: SwitchListTile(
                        secondary: const Icon(Icons.fingerprint),
                        title: const Text('الدخول بالبصمة'),
                        subtitle: const Text(
                          'افتح أسطى ببصمتك بدل ما تستنى كود التحقق كل مرة',
                        ),
                        value: _biometricEnabled,
                        onChanged: _toggleBiometric,
                      ),
                    ),
                  ],
                  const SizedBox(height: 24),
                  Card(
                    child: ExpansionTile(
                      leading: const Icon(Icons.settings_outlined),
                      title: const Text('إدارة الحساب'),
                      subtitle: const Text('إعدادات متقدمة للحساب'),
                      children: [
                        ListTile(
                          leading: Icon(
                            Icons.delete_forever_outlined,
                            color: Theme.of(context).colorScheme.error,
                          ),
                          title: Text(
                            'حذف الحساب نهائيًا',
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                          subtitle: const Text(
                            'لا يمكن التراجع عن العملية بعد تأكيدها',
                          ),
                          trailing: _deletingAccount
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : null,
                          enabled: !_deletingAccount,
                          onTap: _deletingAccount
                              ? null
                              : _confirmDeleteAccount,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}
