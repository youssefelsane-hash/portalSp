import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import 'loyalty_repository.dart';
import 'models.dart';

// نقاط الولاء (docs/08) — كانت فجوة موثّقة صراحة: GET/POST /loyalty/* كانت شغالة ومختبرة في
// الباك-إند من زمان بس مفيش شاشة في التطبيق كانت بتستخدمها — العميل مكانش يقدر يشوف رصيده
// ولا يستبدل نقاطه خالص.
//
// **docs/08 §19 بند 14 — زرار "استبدال نقاط" اتشال عمدًا**: LoyaltyService.redeem() (الباك-إند)
// كان بيعمل بس خصم رصيد + تسجيل معاملة — صفر تحويل فعلي لخصم على سعر أي طلب (مفيش سعر صرف
// نقطة↔جنيه معرَّف أصلاً في القاموس، نفس القرار الموثّق في RedeemLoyaltyPointsDto بالباك-إند).
// يعني العميل كان يقدر "يستبدل" نقاطه ويفقدها فعليًا من غير أي قيمة حقيقية يرجعله — تعليق المالك
// الصريح (تدقيق §19): "إما تعمل points→value حقيقي أو تخفي Redeem بالكامل في V1". بناء سعر صرف
// حقيقي قرار تسعير تجاري (نسبة نقطة/جنيه) مش تقني — يحتاج قرار المالك الصريح (وربما ADR لو
// هيتربط بمحرك التسعير)، مش افتراض اعتباطي هنا. الحل الآمن الفوري: الرصيد وسجل المعاملات (القراءة
// الفعلية، مفيدة وصحيحة) فضلوا زي ما هم، وزرار الاستبدال اتشال بالكامل لحد ما يتحدد سعر الصرف.
class LoyaltyScreen extends StatefulWidget {
  const LoyaltyScreen({super.key});

  @override
  State<LoyaltyScreen> createState() => _LoyaltyScreenState();
}

class _LoyaltyScreenState extends State<LoyaltyScreen> {
  late final LoyaltyRepository _repository;
  int? _balance;
  List<LoyaltyTransaction>? _transactions;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = LoyaltyRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([_repository.fetchBalance(), _repository.fetchTransactions()]);
      if (mounted) {
        setState(() {
          _balance = results[0] as int;
          _transactions = results[1] as List<LoyaltyTransaction>;
        });
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('نقاط الولاء')),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _balance == null
              ? (_error != null ? Center(child: Text(_error!)) : const Center(child: CircularProgressIndicator()))
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          children: [
                            Text('رصيدك', style: Theme.of(context).textTheme.titleMedium),
                            const SizedBox(height: 8),
                            Text('$_balance نقطة', style: Theme.of(context).textTheme.headlineMedium),
                            const SizedBox(height: 8),
                            Text(
                              'نقاط تقديرية حالياً — برنامج استبدال النقاط بمزايا حقيقية جاي قريب',
                              style: Theme.of(context).textTheme.bodySmall,
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      ),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 8),
                      Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    ],
                    const SizedBox(height: 16),
                    Text('سجل المعاملات', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    if (_transactions == null || _transactions!.isEmpty) const EmptyState(icon: Icons.receipt_long_outlined, title: 'مفيش معاملات لسه'),
                    for (final tx in _transactions ?? <LoyaltyTransaction>[])
                      Card(
                        child: ListTile(
                          leading: Icon(
                            tx.direction == 'earn'
                                ? Icons.add_circle_outline
                                : tx.direction == 'redeem'
                                    ? Icons.remove_circle_outline
                                    : Icons.timer_off_outlined,
                            color: tx.direction == 'earn' ? Colors.green : Colors.red,
                          ),
                          title: Text(
                            '${loyaltyDirectionLabelsAr[tx.direction] ?? tx.direction} — ${tx.pointsAmount} نقطة',
                          ),
                          subtitle: Text(
                            tx.direction == 'earn' && tx.expiresAt != null
                                // النقاط بتنتهي فعلاً دلوقتي (تدقيق L-6) — من غير الميعاد ده
                                // العميل بيلاقي رصيده نقص فجأة ومش عارف ليه.
                                ? '${loyaltySourceLabelsAr[tx.source] ?? tx.source} — ${tx.createdAt.substring(0, 10)}\nتنتهي في ${tx.expiresAt!.substring(0, 10)}'
                                : '${loyaltySourceLabelsAr[tx.source] ?? tx.source} — ${tx.createdAt.substring(0, 10)}',
                          ),
                          isThreeLine: tx.direction == 'earn' && tx.expiresAt != null,
                          trailing: Text('الرصيد: ${tx.balanceAfter}'),
                        ),
                      ),
                  ],
                ),
        ),
      ),
    );
  }
}
