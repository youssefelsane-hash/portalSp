import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'models.dart';
import 'referrals_repository.dart';

// ترشيح QR للفني (docs/11 §1) — كانت مؤجّلة عمدًا كـbacklog بند 39. كود الترشيح هو
// technician_code الموجود بالفعل (مفيش عمود جديد) — عميل يمسحه أو يدخله يدويًا وقت التسجيل/بعده
// يتحول لعميل مرشّح من الفني ده، ويكسب الفني مكافأة قابلة للإعداد بالكامل لأول طلب مؤهّل له
// (أو كل طلب، حسب سياسة الأدمن). مسح QR بالكاميرا لسه مش مبني (نفس قرار مسح QR العمائر —
// إدخال يدوي بس، مفيش جهاز حقيقي للاختبار في بيئة التطوير) — العرض/المشاركة هنا كاملين.
class ReferralScreen extends StatefulWidget {
  const ReferralScreen({super.key});

  @override
  State<ReferralScreen> createState() => _ReferralScreenState();
}

class _ReferralScreenState extends State<ReferralScreen> {
  late final ReferralsRepository _repository;
  ReferralSummary? _summary;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = ReferralsRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final summary = await _repository.fetchSummary();
      if (mounted) setState(() => _summary = summary);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _share(String token) async {
    await SharePlus.instance.share(
      ShareParams(
        text: 'استخدم كود الترشيح بتاعي "$token" عشان تحجز أول خدمة معايا على تطبيق baytak! 🛠️',
      ),
    );
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  @override
  Widget build(BuildContext context) {
    final summary = _summary;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('ترشيح العملاء')),
        body: summary == null
            ? (_error != null ? Center(child: Text(_error!)) : const Center(child: CircularProgressIndicator()))
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          children: [
                            const Text('كود الترشيح بتاعك', style: TextStyle(fontWeight: FontWeight.bold)),
                            const SizedBox(height: 12),
                            Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8)),
                              child: QrImageView(data: summary.referralToken, size: 180),
                            ),
                            const SizedBox(height: 12),
                            SelectableText(summary.referralToken, style: Theme.of(context).textTheme.titleMedium),
                            const SizedBox(height: 12),
                            FilledButton.icon(
                              onPressed: () => _share(summary.referralToken),
                              icon: const Icon(Icons.share),
                              label: const Text('مشاركة الكود'),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: _StatCard(
                            label: 'عملاء رشّحتهم',
                            value: '${summary.attributedCustomersCount}',
                            icon: Icons.people_outline,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: _StatCard(
                            label: 'طلبات مؤهّلة',
                            value: '${summary.qualifyingOrdersCount}',
                            icon: Icons.check_circle_outline,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: _StatCard(
                            label: 'مكافآت مستحقة',
                            value: _formatEgp(summary.totalCreditedCents),
                            icon: Icons.account_balance_wallet_outlined,
                            color: Colors.green,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: _StatCard(
                            label: 'مكافآت ملغاة',
                            value: _formatEgp(summary.totalRevokedCents),
                            icon: Icons.cancel_outlined,
                            color: Colors.orange,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Text('آخر المكافآت', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    if (summary.recentBonuses.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: Center(child: Text('لسه مفيش مكافآت — شارك كودك مع عملائك!')),
                      )
                    else
                      for (final bonus in summary.recentBonuses)
                        Card(
                          child: ListTile(
                            leading: Icon(
                              bonus.status == 'credited'
                                  ? Icons.check_circle
                                  : bonus.status == 'revoked'
                                      ? Icons.cancel
                                      : Icons.warning_amber_outlined,
                              color: bonus.status == 'credited'
                                  ? Colors.green
                                  : bonus.status == 'revoked'
                                      ? Colors.red
                                      : Colors.orange,
                            ),
                            title: Text(_formatEgp(bonus.bonusAmountCents)),
                            subtitle: Text(
                              referralBonusStatusLabelsAr[bonus.status] ?? bonus.status,
                            ),
                            trailing: Text(
                              bonus.createdAt.substring(0, 10),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ),
                        ),
                  ],
                ),
              ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color? color;

  const _StatCard({required this.label, required this.value, required this.icon, this.color});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            Icon(icon, color: color ?? Theme.of(context).colorScheme.primary),
            const SizedBox(height: 4),
            Text(value, style: Theme.of(context).textTheme.titleMedium),
            Text(label, style: Theme.of(context).textTheme.bodySmall, textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}
