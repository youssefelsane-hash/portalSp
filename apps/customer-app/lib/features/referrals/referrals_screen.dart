import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'models.dart';
import 'referrals_repository.dart';

class ReferralsScreen extends StatefulWidget {
  const ReferralsScreen({super.key});

  @override
  State<ReferralsScreen> createState() => _ReferralsScreenState();
}

class _ReferralsScreenState extends State<ReferralsScreen> {
  late final ReferralsRepository _repository;
  ReferralInfo? _info;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = ReferralsRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final info = await _repository.fetchMyReferralInfo();
      if (mounted) setState(() => _info = info);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  void _copyCode(String code) {
    Clipboard.setData(ClipboardData(text: code));
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('اتنسخ الكود')));
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('رشّح صحابك')),
        body: _error != null
            ? Center(child: Text(_error!))
            : _info == null
                ? const Center(child: CircularProgressIndicator())
                : _buildBody(_info!),
      ),
    );
  }

  Widget _buildBody(ReferralInfo info) {
    final progress = info.requiredReferralsPerReward == 0
        ? 0.0
        : (info.requiredReferralsPerReward - info.referralsUntilNextReward) / info.requiredReferralsPerReward;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              children: [
                const Text('كود الترشيح بتاعك', style: TextStyle(fontSize: 14, color: Colors.grey)),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      info.referralCode,
                      style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, letterSpacing: 4),
                    ),
                    IconButton(
                      icon: const Icon(Icons.copy),
                      tooltip: 'انسخ الكود',
                      onPressed: () => _copyCode(info.referralCode),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                const Text(
                  'ابعت الكود ده لصحابك — لما حد منهم يكمّل أول طلب فعلي بيه، الترشيح بيتحسب لك',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.grey),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('${info.completedReferralsCount} ترشيح مكتمل', style: const TextStyle(fontWeight: FontWeight.bold)),
                    Text('باقي ${info.referralsUntilNextReward} للمكافأة الجاية'),
                  ],
                ),
                const SizedBox(height: 12),
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: LinearProgressIndicator(value: progress, minHeight: 10),
                ),
                if (info.pendingReferralsCount > 0) ...[
                  const SizedBox(height: 12),
                  Text('${info.pendingReferralsCount} صاحب لسه ماكملش أول طلب — هيتحسبوا أول ما يخلصوا'),
                ],
                const SizedBox(height: 12),
                Text('كل ${info.requiredReferralsPerReward} ترشيحات مكتملة = كود خصم مكافأة بيوصلك إشعار بيه'),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
