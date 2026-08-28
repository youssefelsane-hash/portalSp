import 'package:flutter/material.dart';
import '../../core/auth_repository.dart';
import 'earnings_repository.dart';
import 'models.dart';

String _egp(int cents) => '${(cents / 100).toStringAsFixed(2)} ج.م';

/// شهر `YYYY-MM` بالعربي — «أغسطس 2026».
String _monthLabel(String month) {
  const names = [
    'يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ];
  final parts = month.split('-');
  if (parts.length != 2) return month;
  final index = int.tryParse(parts[1]);
  if (index == null || index < 1 || index > 12) return month;
  return '${names[index - 1]} ${parts[0]}';
}

/// «مستحقاتي» — كشف الشهر (docs/08 §61.1، ADR-0038).
///
/// كل الحساب بيتم في الباك-إند؛ الشاشة دي عرض بحت. ولا الفني ولا الأدمن بيحسب أي حاجة يدوي،
/// والرقم اللي بيشوفه الفني هنا هو **نفس** الرقم اللي بيشوفه الأدمن (نفس الـservice بالحرف).
class MonthlyStatementScreen extends StatefulWidget {
  const MonthlyStatementScreen({super.key, required this.auth});

  final AuthRepository auth;

  @override
  State<MonthlyStatementScreen> createState() => _MonthlyStatementScreenState();
}

class _MonthlyStatementScreenState extends State<MonthlyStatementScreen> {
  late final EarningsRepository _repository = EarningsRepository(widget.auth);
  List<String> _months = [];
  String? _selectedMonth;
  MonthlyStatement? _statement;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({String? month}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final months = _months.isEmpty ? await _repository.fetchAvailableMonths() : _months;
      final statement = await _repository.fetchMonthlyStatement(month: month ?? _selectedMonth);
      if (!mounted) return;
      setState(() {
        _months = months;
        _selectedMonth = statement.month;
        _statement = statement;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = 'مقدرناش نجيب الكشف دلوقتي — جرّب تاني.';
        _loading = false;
      });
      debugPrint('فشل تحميل كشف المستحقات: $error');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('مستحقاتي')),
      body: RefreshIndicator(
        onRefresh: () => _load(month: _selectedMonth),
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? ListView(children: [Padding(padding: const EdgeInsets.all(32), child: Center(child: Text(_error!)))])
                : _buildBody(context),
      ),
    );
  }

  Widget _buildBody(BuildContext context) {
    final statement = _statement!;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_months.length > 1) _monthPicker(),
        const SizedBox(height: 12),
        _summaryCard(context, statement),
        const SizedBox(height: 16),
        Text('الشغلانات (${statement.jobsCount})', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        if (statement.jobs.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(child: Text('مفيش شغل مقفول في الشهر ده')),
          )
        else
          ...statement.jobs.map((job) => _jobCard(context, job)),
      ],
    );
  }

  Widget _monthPicker() {
    return DropdownButtonFormField<String>(
      initialValue: _selectedMonth,
      decoration: const InputDecoration(labelText: 'الشهر', border: OutlineInputBorder()),
      items: _months.map((m) => DropdownMenuItem(value: m, child: Text(_monthLabel(m)))).toList(),
      onChanged: (value) {
        if (value != null) _load(month: value);
      },
    );
  }

  Widget _summaryCard(BuildContext context, MonthlyStatement statement) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              // «حتى هذه اللحظة» للشهر الجاري بس — الشهر المقفول رقمه نهائي.
              statement.isCurrentMonth
                  ? 'إجمالي مستحقاتك لحد دلوقتي'
                  : 'إجمالي مستحقاتك عن ${_monthLabel(statement.month)}',
              style: TextStyle(color: scheme.onPrimaryContainer),
            ),
            const SizedBox(height: 6),
            Text(
              _egp(statement.totals.netTechnicianDueCents),
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                    color: scheme.onPrimaryContainer,
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 8),
            Text(
              'من ${statement.monthStart} لـ ${statement.monthEnd}',
              style: TextStyle(fontSize: 12, color: scheme.onPrimaryContainer.withValues(alpha: 0.75)),
            ),
            if (statement.totals.customerDiscountCents > 0) ...[
              const SizedBox(height: 10),
              // طلب مالك صريح: الفني لازم يشوف بعينه إن الكوبونات ما اتخصمتش منه.
              Row(
                children: [
                  Icon(Icons.info_outline, size: 16, color: scheme.onPrimaryContainer),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'فيه خصومات على العملاء بقيمة ${_egp(statement.totals.customerDiscountCents)} — الشركة تحمّلتها بالكامل، ومستحقاتك مش متأثرة بيها.',
                      style: TextStyle(fontSize: 12, color: scheme.onPrimaryContainer),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  static const _roleLabels = {'team_member': 'عضو فريق', 'assistant': 'مساعد'};

  Widget _jobCard(BuildContext context, StatementJob job) {
    final roleLabel = _roleLabels[job.participantRole];
    return Card(
      child: ExpansionTile(
        title: Text(job.serviceNameAr ?? 'طلب ${job.orderNumber}'),
        subtitle: Text(
          roleLabel == null
              ? '${job.orderNumber} — ${job.closedAt.split('T').first}'
              : '${job.orderNumber} — ${job.closedAt.split('T').first} — شاركت كـ$roleLabel',
        ),
        trailing: Text(
          _egp(job.netTechnicianDueCents),
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        children: [
          // شغلانة طاقم: السطور الجاية (السعر الأصلي، العمولة...) بتوصف الطلب كله مش نصيبك بس —
          // ده السياق اللي بيوضّح تكوين نصيبك، مش رقم مفروض يتجمع عليه (§90.1).
          _row('السعر الأصلي للخدمة', _egp(job.originalPriceCents)),
          if (job.additionalWorkCents > 0) _row('زيادات أثناء الشغل', _egp(job.additionalWorkCents)),
          if (job.levelPremiumCents > 0) _row('فرق مستواك (فني مميّز)', _egp(job.levelPremiumCents)),
          if (job.customerDiscountCents > 0) ...[
            _row('خصم العميل', '− ${_egp(job.customerDiscountCents)}'),
            _row('اللي العميل دفعه', _egp(job.customerPaidCents)),
            // السطر ده مقصود يفضل ظاهر حتى وهو صفر — هو الإجابة على السؤال "الكوبون خصم مني؟".
            _row('خصم محمّل عليك', _egp(job.discountBorneByTechnicianCents), highlight: true),
          ],
          const Divider(),
          // كان بيتحسب بطرح صافي مستحقك من الوعاء — غلط لشغلانات الطاقم (نصيبك مش الوعاء كله)
          // ولكوبونات المنصة المموّلة بالكامل (تظهر عمولة موجبة رغم إن المنصة فعليًا دافعة فرق،
          // platformCommissionCents سالبة في الحالة دي) — استخدام الحقل الجاهز من الباك-إند أدق.
          _row(
            'عمولة الشركة (${job.commissionRatePercentage.toStringAsFixed(0)}%)',
            job.platformCommissionCents >= 0
                ? '− ${_egp(job.platformCommissionCents)}'
                : '+ ${_egp(job.platformCommissionCents.abs())} (الشركة تحمّلت الفرق)',
          ),
          if (job.refundReversalCents > 0)
            _row('اتخصم بسبب استرداد للعميل', '− ${_egp(job.refundReversalCents)}', highlight: true),
          _row('صافي مستحقك', _egp(job.netTechnicianDueCents), bold: true),
        ],
      ),
    );
  }

  Widget _row(String label, String value, {bool bold = false, bool highlight = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(fontWeight: bold ? FontWeight.bold : FontWeight.normal)),
          Text(
            value,
            style: TextStyle(
              fontWeight: bold || highlight ? FontWeight.bold : FontWeight.normal,
              color: highlight ? Colors.green.shade700 : null,
            ),
          ),
        ],
      ),
    );
  }
}
