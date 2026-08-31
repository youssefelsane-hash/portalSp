import 'package:flutter/material.dart';
import '../../core/auth_repository.dart';
import 'earnings_repository.dart';
import 'models.dart';

String _egp(int cents) => '${(cents / 100).toStringAsFixed(2)} ج.م';

/// شهر `YYYY-MM` بالعربي — «أغسطس 2026».
String _monthLabel(String month) {
  const names = [
    'يناير',
    'فبراير',
    'مارس',
    'إبريل',
    'مايو',
    'يونيو',
    'يوليو',
    'أغسطس',
    'سبتمبر',
    'أكتوبر',
    'نوفمبر',
    'ديسمبر',
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
/// والـAPI العام بيرجع للعامل حصته وحركة محفظته فقط؛ تفاصيل الطلب والمنصة تفضل للأدمن.
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
      final months = _months.isEmpty
          ? await _repository.fetchAvailableMonths()
          : _months;
      final statement = await _repository.fetchMonthlyStatement(
        month: month ?? _selectedMonth,
      );
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
            ? ListView(
                children: [
                  Padding(
                    padding: const EdgeInsets.all(32),
                    child: Center(child: Text(_error!)),
                  ),
                ],
              )
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
        Text(
          'الشغلانات (${statement.jobsCount})',
          style: Theme.of(context).textTheme.titleMedium,
        ),
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
      decoration: const InputDecoration(
        labelText: 'الشهر',
        border: OutlineInputBorder(),
      ),
      items: _months
          .map((m) => DropdownMenuItem(value: m, child: Text(_monthLabel(m))))
          .toList(),
      onChanged: (value) {
        if (value != null) _load(month: value);
      },
    );
  }

  Widget _summaryCard(BuildContext context, MonthlyStatement statement) {
    final scheme = Theme.of(context).colorScheme;
    final isDebt = statement.totals.netTechnicianDueCents < 0;
    final foreground = isDebt
        ? scheme.onErrorContainer
        : scheme.onPrimaryContainer;
    return Card(
      color: isDebt ? scheme.errorContainer : scheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              // «حتى هذه اللحظة» للشهر الجاري بس — الشهر المقفول رقمه نهائي.
              isDebt
                  ? 'مطلوب منك للمنصة عن شغل ${statement.isCurrentMonth ? 'الشهر لحد دلوقتي' : _monthLabel(statement.month)}'
                  : statement.isCurrentMonth
                  ? 'صافي حركة محفظتك من شغل الشهر لحد دلوقتي'
                  : 'صافي حركة محفظتك عن ${_monthLabel(statement.month)}',
              style: TextStyle(color: foreground),
            ),
            const SizedBox(height: 6),
            Text(
              _egp(statement.totals.netTechnicianDueCents.abs()),
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                color: foreground,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'إجمالي نصيبك ${_egp(statement.totals.grossTechnicianEarningCents)} · كاش استلمته ${_egp(statement.totals.cashCollectedCents)}',
              style: TextStyle(fontSize: 12, color: foreground),
            ),
            if (statement.totals.refundReversalCents > 0) ...[
              const SizedBox(height: 6),
              Text(
                'استردادات اتخصمت من حصتك ${_egp(statement.totals.refundReversalCents)}',
                style: TextStyle(fontSize: 12, color: foreground),
              ),
            ],
            const SizedBox(height: 8),
            Text(
              'من ${statement.monthStart} لـ ${statement.monthEnd}',
              style: TextStyle(
                fontSize: 12,
                color: foreground.withValues(alpha: 0.75),
              ),
            ),
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
          _row('نصيبك من الشغل', _egp(job.grossTechnicianEarningCents)),
          if (job.refundReversalCents > 0)
            _row(
              'اتخصم بسبب استرداد للعميل',
              '− ${_egp(job.refundReversalCents)}',
              highlight: true,
            ),
          if (job.cashCollectedCents > 0)
            _row(
              'كاش استلمته من العميل',
              '− ${_egp(job.cashCollectedCents)}',
              highlight: true,
            ),
          _row(
            job.netTechnicianDueCents < 0
                ? 'مطلوب منك للمنصة بسبب الطلب'
                : 'صافي أثر الطلب على محفظتك',
            _egp(job.netTechnicianDueCents.abs()),
            bold: true,
            error: job.netTechnicianDueCents < 0,
          ),
        ],
      ),
    );
  }

  Widget _row(
    String label,
    String value, {
    bool bold = false,
    bool highlight = false,
    bool error = false,
  }) {
    // docs/08 §108-H — بَقّة overflow منهجية: التسمية أحيانًا نص طويل (زي "عمولة الشركة (٪X)"
    // أو "+ Y (الشركة تحمّلت الفرق)") وكانت من غير Expanded/Flexible خالص، فبتفيض على شاشة
    // صغيرة أو خط كبير. الرقم بيفضل زي ما هو (تقصيره مضلل لمبلغ مالي)، والتسمية بس بتنكمش بـ"...".
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontWeight: bold ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            value,
            style: TextStyle(
              fontWeight: bold || highlight
                  ? FontWeight.bold
                  : FontWeight.normal,
              color: error
                  ? Theme.of(context).colorScheme.error
                  : highlight
                  ? Colors.green.shade700
                  : null,
            ),
          ),
        ],
      ),
    );
  }
}
