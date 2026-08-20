import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/app_theme.dart';
import '../../design/loading_list.dart';
import 'models.dart';
import 'schedule_repository.dart';

const _arabicMonthNames = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];
const _arabicWeekdayShort = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];

// إتاحية الفني — نموذج مبسّط باليوم (docs/08 §34.3، ADR-0017). الافتراض: الفني متاح دايمًا،
// إلا لو حظر يوم بعينه صراحة. الشاشة دي بديل كامل لسحابة "إضافة سلوت بساعة" القديمة — تعديل جماعي
// سريع (تحديد عدة أيام مرة واحدة، أسبوع كامل، شهر كامل) بدل يوم بيوم. أي سلوتات ساعية قديمة (لو
// موجودة من زمان) لسه بتتفحص من الباك-إند بنفس المعنى، وأي حظر جماعي جديد فوقها بيستبدلها بيوم
// كامل — التوافق محفوظ من غير ما الواجهة تعرض تعقيد الساعات تاني.
class ScheduleScreen extends StatefulWidget {
  const ScheduleScreen({super.key});

  @override
  State<ScheduleScreen> createState() => _ScheduleScreenState();
}

class _ScheduleScreenState extends State<ScheduleScreen> {
  late final ScheduleRepository _repository;
  List<ScheduleSlot>? _slots;
  String? _error;
  bool _submitting = false;
  DateTime _visibleMonth = DateTime(DateTime.now().year, DateTime.now().month, 1);
  final Set<String> _selectedDates = {};

  @override
  void initState() {
    super.initState();
    _repository = ScheduleRepository(context.read<AuthRepository>());
    _load();
  }

  String _fmt(DateTime date) =>
      '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

  Future<void> _load() async {
    try {
      final today = DateTime.now();
      final from = DateTime(today.year, today.month, today.day);
      final to = from.add(const Duration(days: 180));
      final slots = await _repository.list(from: _fmt(from), to: _fmt(to));
      if (mounted) setState(() => _slots = slots);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Set<String> get _blockedDates => {
        for (final slot in _slots ?? const <ScheduleSlot>[])
          if (slot.status == 'blocked') slot.slotDate,
      };

  Set<String> get _bookedDates => {
        for (final slot in _slots ?? const <ScheduleSlot>[])
          if (slot.status == 'booked') slot.slotDate,
      };

  List<DateTime?> _gridDays() {
    final first = DateTime(_visibleMonth.year, _visibleMonth.month, 1);
    final daysInMonth = DateTime(_visibleMonth.year, _visibleMonth.month + 1, 0).day;
    final leading = first.weekday % 7; // Dart: Mon=1..Sun=7 → الأحد أول عمود (leading=0)
    return [
      for (var i = 0; i < leading; i++) null,
      for (var day = 1; day <= daysInMonth; day++) DateTime(_visibleMonth.year, _visibleMonth.month, day),
    ];
  }

  bool _isPast(DateTime date) {
    final today = DateTime.now();
    return date.isBefore(DateTime(today.year, today.month, today.day));
  }

  void _toggleDate(DateTime date) {
    if (_isPast(date) || _bookedDates.contains(_fmt(date))) return;
    setState(() {
      final key = _fmt(date);
      if (_selectedDates.contains(key)) {
        _selectedDates.remove(key);
      } else {
        _selectedDates.add(key);
      }
    });
  }

  void _selectCurrentWeek() {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final weekStart = today.subtract(Duration(days: today.weekday % 7));
    setState(() {
      for (var i = 0; i < 7; i++) {
        final date = weekStart.add(Duration(days: i));
        if (!_isPast(date) && !_bookedDates.contains(_fmt(date))) _selectedDates.add(_fmt(date));
      }
    });
  }

  void _selectVisibleMonth() {
    setState(() {
      for (final date in _gridDays()) {
        if (date == null) continue;
        if (!_isPast(date) && !_bookedDates.contains(_fmt(date))) _selectedDates.add(_fmt(date));
      }
    });
  }

  void _clearSelection() => setState(() => _selectedDates.clear());

  Future<void> _applyBulkAction(String action) async {
    if (_selectedDates.isEmpty || _submitting) return;
    setState(() => _submitting = true);
    try {
      await _repository.bulkSetAvailability(dates: _selectedDates.toList(), action: action);
      _selectedDates.clear();
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('إتاحتي')),
        body: _error != null
            ? Center(child: Text(_error!))
            : _slots == null
                ? const Padding(padding: EdgeInsets.all(16), child: LoadingList())
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      children: [
                        Container(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          decoration: BoxDecoration(
                            color: context.infoColor.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Row(
                            children: [
                              Icon(Icons.info_outline, color: context.infoColor, size: 20),
                              const SizedBox(width: AppSpacing.sm),
                              const Expanded(
                                child: Text(
                                  'أنت متاح افتراضيًا كل يوم. حدد الأيام اللي عايز تعلّمها "غير متاح" بس.',
                                  style: TextStyle(fontSize: 13),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: AppSpacing.lg),
                        _monthHeader(),
                        const SizedBox(height: AppSpacing.sm),
                        _quickActionsRow(),
                        const SizedBox(height: AppSpacing.md),
                        _weekdayHeaderRow(),
                        _calendarGrid(),
                        const SizedBox(height: AppSpacing.md),
                        _legend(),
                        const SizedBox(height: AppSpacing.xxl + AppSpacing.xl),
                      ],
                    ),
                  ),
        bottomNavigationBar: _selectedDates.isEmpty
            ? null
            : SafeArea(
                child: Padding(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${_selectedDates.length} يوم محدد',
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                      ),
                      TextButton(onPressed: _submitting ? null : _clearSelection, child: const Text('مسح')),
                      const SizedBox(width: AppSpacing.sm),
                      OutlinedButton(
                        onPressed: _submitting ? null : () => _applyBulkAction('unblock'),
                        child: const Text('متاح'),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      FilledButton(
                        onPressed: _submitting ? null : () => _applyBulkAction('block'),
                        style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
                        child: _submitting
                            ? const SizedBox(
                                width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : const Text('غير متاح'),
                      ),
                    ],
                  ),
                ),
              ),
      ),
    );
  }

  Widget _monthHeader() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        IconButton(
          icon: const Icon(Icons.chevron_right),
          onPressed: () => setState(() => _visibleMonth = DateTime(_visibleMonth.year, _visibleMonth.month - 1, 1)),
        ),
        Text(
          '${_arabicMonthNames[_visibleMonth.month - 1]} ${_visibleMonth.year}',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        IconButton(
          icon: const Icon(Icons.chevron_left),
          onPressed: () => setState(() => _visibleMonth = DateTime(_visibleMonth.year, _visibleMonth.month + 1, 1)),
        ),
      ],
    );
  }

  Widget _quickActionsRow() {
    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: [
        OutlinedButton(onPressed: _selectCurrentWeek, child: const Text('الأسبوع الحالي')),
        OutlinedButton(onPressed: _selectVisibleMonth, child: const Text('الشهر المعروض كله')),
        if (_selectedDates.isNotEmpty) TextButton(onPressed: _clearSelection, child: const Text('مسح التحديد')),
      ],
    );
  }

  Widget _weekdayHeaderRow() {
    return Row(
      children: [
        for (final label in _arabicWeekdayShort)
          Expanded(
            child: Center(
              child: Text(label, style: Theme.of(context).textTheme.labelSmall),
            ),
          ),
      ],
    );
  }

  Widget _calendarGrid() {
    final days = _gridDays();
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: days.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 7),
      itemBuilder: (context, index) {
        final date = days[index];
        if (date == null) return const SizedBox.shrink();
        return _dayCell(date);
      },
    );
  }

  Widget _dayCell(DateTime date) {
    final key = _fmt(date);
    final isPast = _isPast(date);
    final isBooked = _bookedDates.contains(key);
    final isBlocked = _blockedDates.contains(key);
    final isSelected = _selectedDates.contains(key);

    Color? background;
    Color? foreground;
    if (isBooked) {
      background = context.infoColor.withValues(alpha: 0.15);
      foreground = context.infoColor;
    } else if (isBlocked) {
      background = Theme.of(context).colorScheme.error.withValues(alpha: 0.12);
      foreground = Theme.of(context).colorScheme.error;
    }
    if (isSelected) {
      background = Theme.of(context).colorScheme.primary;
      foreground = Theme.of(context).colorScheme.onPrimary;
    }

    return Padding(
      padding: const EdgeInsets.all(2),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: (isPast || isBooked) ? null : () => _toggleDate(date),
        child: Container(
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(8),
            border: isSelected ? null : Border.all(color: Theme.of(context).colorScheme.outlineVariant, width: 0.5),
          ),
          alignment: Alignment.center,
          child: Text(
            '${date.day}',
            style: TextStyle(
              color: isPast ? Theme.of(context).disabledColor : foreground,
              fontWeight: isSelected || isBlocked || isBooked ? FontWeight.bold : FontWeight.normal,
            ),
          ),
        ),
      ),
    );
  }

  Widget _legend() {
    Widget dot(Color color, String label) => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(width: 10, height: 10, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
            const SizedBox(width: 4),
            Text(label, style: Theme.of(context).textTheme.labelSmall),
          ],
        );
    return Wrap(
      spacing: AppSpacing.md,
      runSpacing: AppSpacing.xs,
      children: [
        dot(Theme.of(context).colorScheme.error, 'غير متاح'),
        dot(context.infoColor, 'محجوز بطلب'),
        dot(Theme.of(context).colorScheme.primary, 'محدد الآن'),
      ],
    );
  }
}
