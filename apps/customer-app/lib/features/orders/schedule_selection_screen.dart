import 'package:flutter/material.dart';

import '../../core/api_client.dart';

// "امتى تحب تنفّذ الشغل؟" (docs/08 §154، ADR-0018 §2) — العميل بيختار يوم بس، مش ساعة محددة.
// **تصحيح (ADR-0018 §2)**: النسخة الأولى من الشاشة دي كانت بتاخد ساعة محددة كمان ("النهاردة
// الساعة كام؟") — ده يخالف قصد المالك الصريح: "العميل بيختار اليوم، مش بيوعد الفني بساعة معينة
// (2:30، 5:15). المطابقة بتسأل: الفني ده يقدر ياخد شغلانة تانية في اليوم ده؟ مش بتعتمد على
// سلوتات دقيقة بالدقيقة." الباك-إند لسه بيخزّن scheduled_at كـtimestamp (فايدة تقنية للفرز/الحسابات
// الداخلية)، لكن قيمته دايمًا بداية اليوم المطلوب — العميل ميختارش وقت خالص من هنا.
// **تصحيح تاني (docs/08 §32.3، طلب مالك صريح 2026-08-20)**: خيار "في أقرب وقت ممكن" (ASAP) اتشال
// نهائيًا — بلاغ مالك حقيقي: كان بيتبع قاعدة أهلية مختلفة عن "اختار تاريخ تاني" (حتى لنفس اليوم)،
// فكان بيرفض فنيين متاحين فعلاً بحجة تعارض وهمي (تفاصيل كاملة في docs/08 §32.1/§32.2 وتعليق
// technician-eligibility.sql.ts). التاريخ بقى إجباري دايمًا — تقويم يفتح على طول، بلا خطوة اختيار
// وسيطة، بالظبط زي مسار "اختار تاريخ تاني" القديم بلا أي تغيير فيه. أُضيف خيار "مرن" (نطاق أيام)
// بجانبه — الباك-إند بيختار أقرب يوم فعليًا متاح جوّه النطاق (orders.service.ts، أقصى 14 يوم).
//
// **تصحيح تالت (docs/08 §84 جزء ج، طلب مالك صريح 2026-08-28)**: للخدمات اللي محتاجة وقت بداية
// دقيق (requiresPreciseSchedule/requiresStartTimeOnly، ADR-0031 Slice B)، الساعة (+عدد الساعات
// لـrequiresPreciseSchedule بس) بقت تُسأل هنا كمان — في نفس الخطوة، فوراً بعد اليوم — بدل ما
// تتأجّل لحد CreateOrderScreen بعيد. طلب المالك حرفيًا: "خلي حاجات الوقت كلها تظهر مع بعض عادي
// جدًا". **صفر تغيير على الحجوزات العادية (يوم بس)** — التوسيع ده مقصور تمامًا على الخدمات اللي
// أصلاً بتحتاج وقت دقيق، عشان منرجعش لبَقّة ADR-0018 §2 (مطابقة بدقة الدقيقة لحجوزات عادية).
class ScheduleChoice {
  final DateTime scheduledAt;
  // "مرن — اختار نطاق أيام" (docs/08 §32.3) — null يعني يوم محدد واحد بس (مفيش نطاق).
  final DateTime? rangeEnd;
  // دقة الموعد (ADR-0060 §4) — مليان بس لو requiresPreciseTime، وإلا null دايمًا.
  //
  // `durationHours` اتشال: المدة بقت ناتج معادلة التسعير، مش رقم بيدخّله العميل على شاشة
  // اختيار الميعاد. شاشة الجدولة بتجاوب على سؤال واحد بس: امتى الفني ييجي؟
  final TimeOfDay? preciseTime;
  const ScheduleChoice(this.scheduledAt, {this.rangeEnd, this.preciseTime});
}

// بداية اليوم المحلي (Africa/Cairo، نفس منطقة العمل الوحيدة للمشروع) — نفس التاريخ اللي هيتعرض
// للفني/الأدمن، بلا أي مكون وقت. `DateTime` المحلي هنا كافي (السيرفر بيحوّله UTC عند الإرسال).
DateTime _startOfDay(DateTime date) =>
    DateTime(date.year, date.month, date.day);

// أقصى فرق بين بداية ونهاية النطاق المرن — matching orders.service.ts's اقتصادها بالحرف
// (استعلام أهلية يومي متكرر بحد أقصى، مش نطاق مفتوح).
const int _maxFlexibleRangeDays = 14;

class ScheduleSelectionScreen extends StatefulWidget {
  // قدرة "نطاق أيام مرن" لكل خدمة (ADR-0028، docs/08 §42 Phase A.2) — لو false، كارت "مرن" بيتخفي
  // بدل ما العميل يختاره ويترفض من الباك-إند بعدين (orders.service.ts).
  final bool allowsDateRangeBooking;
  // محتاجة وقت بداية دقيق (docs/08 §84 جزء ج) — لو true، كارت "الساعة" بيظهر بعد اختيار اليوم.
  final bool requiresPreciseTime;
  /// هل الخدمة بتتعمل في نفس اليوم؟ (`allows_emergency`، ADR-0048 §3).
  ///
  /// لو `false`، التقويم بيبدأ من **بكرة** — العميل مايختارش يوم الباك-إند هيرفضه بعدين. نفس
  /// فلسفة `allowsDateRangeBooking` فوق بالحرف.
  final bool allowsSameDay;

  const ScheduleSelectionScreen({
    super.key,
    required this.allowsDateRangeBooking,
    this.requiresPreciseTime = false,
    this.allowsSameDay = true,
  });

  @override
  State<ScheduleSelectionScreen> createState() =>
      _ScheduleSelectionScreenState();
}

class _ScheduleSelectionScreenState extends State<ScheduleSelectionScreen> {
  // عتبة "الشغل القريب" بالساعات (docs/08 §61.3) — null لحد ما تتحمّل، و0 معناه الأدمن عطّل
  // النظام ده فمفيش تنبيه يتعرض. فشل التحميل بيسيبها null بهدوء: التنبيه معلومة مساعدة،
  // مايصحّش يمنع العميل من اختيار موعد.
  int? _nearTermHours;

  // حالة محلية بس للخدمات اللي محتاجة وقت دقيق (docs/08 §84 جزء ج) — الحجوزات العادية لسه بتاخد
  // اليوم وتقفل الشاشة فورًا زي ما كانت دايمًا، صفر state إضافية ليها.
  DateTime? _selectedDate;
  DateTime? _selectedRangeEnd;
  TimeOfDay? _selectedTime;
  final _durationController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadBookingPolicy();
  }

  @override
  void dispose() {
    _durationController.dispose();
    super.dispose();
  }

  // `/booking-policy` عام (`@Public()`) — فالشاشة دي بتقراه بنفسها بدل ما تستنى الشاشة اللي
  // فتحتها تمرّرهولها. ده مهم لأن ليها مدخلين مختلفين (`create_order_screen` و
  // `catalog_navigation`)، وواحد منهم مكانش بيعرف الرقم ده أصلاً.
  Future<void> _loadBookingPolicy() async {
    try {
      final data = await apiRequest('GET', '/booking-policy');
      if (!mounted) return;
      setState(
        () => _nearTermHours = (data?['near_term_request_hours'] as num?)
            ?.toInt(),
      );
    } catch (error) {
      debugPrint('فشل تحميل سياسة المواعيد: $error');
    }
  }

  /// هل اليوم ده هو النهارده؟ — نفس تعريف الباك-إند (`isSameDayUrgent`) بس بتوقيت الجهاز.
  ///
  /// **الجهاز مش مصدر الحقيقة هنا عمدًا**: الباك-إند بيعيد الاشتقاق من جديد بتوقيت القاهرة وهو
  /// اللي بيقرر فعليًا (ADR-0048 §1). الفحص المحلي ده غرضه **التنبيه قبل الاختيار** بس — لو
  /// ساعة الجهاز غلط، أسوأ حاجة هتحصل إن التنبيه يظهر أو ما يظهرش، والسعر يفضل صح.
  bool _isToday(DateTime date) {
    final now = DateTime.now();
    return date.year == now.year &&
        date.month == now.month &&
        date.day == now.day;
  }

  /// أول يوم مسموح في التقويم — بكرة لو الخدمة مابتتعملش في نفس اليوم (ADR-0048 §3).
  DateTime get _firstSelectableDate {
    final now = DateTime.now();
    return widget.allowsSameDay ? now : now.add(const Duration(days: 1));
  }

  /// **تبسيط التنبيه (طلب مالك صريح، docs/08 §87)**: النسخة الأولى (docs/08 §85) كانت بألوان
  /// حمرا/تحذيرية (أيقونة+عنوان بلون `error`، زرار تأكيد أحمر) وبتذكر نسبة الرسوم بالرقم صراحة
  /// ("رسوم استعجال 20% فوق سعر الخدمة"). المالك اعتبرها "تخض" و"مش تحذير فعلي".
  ///
  /// **مراجعة تانية (بلاغ مالك 2026-09-04)**: النسخة اللي بعدها لسه كانت بتخوّف — «هيوصلك الفني
  /// بسرعة بس هتدفع فلوس زيادة». سطر الرسوم اتشال خالص: **الإجمالي الحقيقي (وهو شامل رسم
  /// الاستعجال أصلاً) بيتعرض للعميل في الشاشة اللي بعد دي مباشرةً وقبل أي تأكيد**، فذكره هنا
  /// كان تحذير مكرر بلا رقم — أسوأ حاجة ممكن تتقال: قلق بلا معلومة. الرسالة بقت بتقول اللي
  /// بيحصل فعلاً (بندوّر على متخصص دلوقتي) وبتطمّن إن السعر هيبان قبل التأكيد.
  ///
  /// **ده إخطار مش سؤال عن وضع الحجز.** العميل مابيختارش "طوارئ ولا عادي" — هو بيختار يوم،
  /// والنتيجة بتتشرح له بصراحة مع فرصة يرجع يغيّر اليوم لو مش مستعجل.
  Future<bool> _confirmSameDayUrgency(BuildContext context) async {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          icon: Icon(Icons.bolt_outlined, color: scheme.primary, size: 28),
          title: const Text('طلب النهارده', textAlign: TextAlign.center),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'هنبدأ ندوّر لك على متخصص متاح النهارده على طول.',
                textAlign: TextAlign.center,
                style: textTheme.bodyMedium,
              ),
              const SizedBox(height: 6),
              Text(
                'هتشوف السعر النهائي قدامك قبل ما تأكّد.',
                textAlign: TextAlign.center,
                style: textTheme.bodySmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('أختار يوم تاني'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('تمام، كمّل'),
            ),
          ],
        ),
      ),
    );
    return accepted == true;
  }

  Future<void> _pickSpecificDate(BuildContext context) async {
    final firstDate = _firstSelectableDate;
    final date = await showDatePicker(
      context: context,
      // الافتراضي بعد يومين — بعيد عن نافذة الاستعجال عمدًا، فالعميل اللي بيدوس "تمام" بسرعة
      // مايتفاجئش برسوم. `firstDate` بتحكم الحد الأدنى الحقيقي.
      initialDate: firstDate.add(const Duration(days: 2)),
      firstDate: firstDate,
      lastDate: DateTime.now().add(const Duration(days: 90)),
    );
    if (date == null || !context.mounted) return;
    if (_isToday(date) && !await _confirmSameDayUrgency(context)) return;
    if (!context.mounted) return;
    if (!widget.requiresPreciseTime) {
      Navigator.of(context).pop(ScheduleChoice(_startOfDay(date)));
      return;
    }
    setState(() {
      _selectedDate = _startOfDay(date);
      _selectedRangeEnd = null;
    });
  }

  Future<void> _pickFlexibleRange(BuildContext context) async {
    final now = DateTime.now();
    final range = await showDateRangePicker(
      context: context,
      initialDateRange: DateTimeRange(
        start: now.add(const Duration(days: 1)),
        end: now.add(const Duration(days: 4)),
      ),
      firstDate: _firstSelectableDate,
      lastDate: now.add(const Duration(days: 90)),
      helpText: 'اختار نطاق الأيام اللي تناسبك',
    );
    if (range == null || !context.mounted) return;
    // النطاق المرن بيبدأ من النهارده = نفس القاعدة بالظبط (الباك-إند بيحل النطاق لأقرب يوم متاح،
    // وممكن يطلع النهارده فعلاً) — فالتنبيه لازم يظهر هنا كمان، مش في مسار اليوم المحدد بس.
    if (_isToday(range.start) && !await _confirmSameDayUrgency(context)) return;
    if (!context.mounted) return;
    final start = _startOfDay(range.start);
    var end = _startOfDay(range.end);
    // العميل يقدر يختار نطاق أوسع من الحد المسموح بيه — بنقصّه للحد الأقصى بدل ما نرفض الاختيار
    // كله ونرجّعه يعيد من الأول (تجربة استخدام أسهل، والنتيجة العملية واحدة: أقرب يوم متاح جوّه
    // أول 14 يوم من اختياره).
    final maxEnd = start.add(const Duration(days: _maxFlexibleRangeDays));
    if (end.isAfter(maxEnd)) end = maxEnd;
    if (!widget.requiresPreciseTime) {
      Navigator.of(context).pop(ScheduleChoice(start, rangeEnd: end));
      return;
    }
    setState(() {
      _selectedDate = start;
      _selectedRangeEnd = end;
    });
  }

  Future<void> _pickTime(BuildContext context) async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _selectedTime ?? const TimeOfDay(hour: 10, minute: 0),
    );
    if (picked != null && mounted) setState(() => _selectedTime = picked);
  }

  String _formatDate(DateTime date) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(date.day)}/${two(date.month)}/${date.year}';
  }

  bool get _canConfirm => _selectedDate != null && _selectedTime != null;

  void _confirm() {
    if (!_canConfirm) return;
    // راجع docs/08 §108-C — شيل الفوكس قبل الإقفال عشان نتجنب Flutter assertion
    // '_dependents.isEmpty' (شاشة حمرا) لو المستخدم لسه واقف في حقل.
    FocusScope.of(context).unfocus();
    Navigator.of(context).pop(
      ScheduleChoice(
        _selectedDate!,
        rangeEnd: _selectedRangeEnd,
        preciseTime: _selectedTime,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('امتى تحب تنفّذ الشغل؟')),
        body: SafeArea(
          child: SingleChildScrollView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: EdgeInsets.fromLTRB(
              20,
              20,
              20,
              20 + MediaQuery.viewInsetsOf(context).bottom,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 8),
                _ScheduleOptionCard(
                  icon: Icons.calendar_month_outlined,
                  title: 'اختار يوم محدد',
                  subtitle: _selectedDate != null && _selectedRangeEnd == null
                      ? _formatDate(_selectedDate!)
                      : 'حدد اليوم اللي يناسبك من الكالندر',
                  highlighted: true,
                  selected: _selectedDate != null && _selectedRangeEnd == null,
                  onTap: () => _pickSpecificDate(context),
                ),
                if (widget.allowsDateRangeBooking) ...[
                  const SizedBox(height: 12),
                  _ScheduleOptionCard(
                    icon: Icons.event_repeat_outlined,
                    title: 'مرن — اختار نطاق أيام',
                    subtitle: _selectedRangeEnd != null
                        ? '${_formatDate(_selectedDate!)} — ${_formatDate(_selectedRangeEnd!)}'
                        : 'هنجيبلك أقرب يوم فيه فني متاح جوّه النطاق اللي تختاره',
                    selected: _selectedRangeEnd != null,
                    onTap: () => _pickFlexibleRange(context),
                  ),
                ],
                // خطوة الساعة (+عدد الساعات) — بتظهر بمجرد ما يختار العميل يوم، في نفس الشاشة دي
                // مباشرة (docs/08 §84 جزء ج، طلب مالك صريح: "خلي حاجات الوقت كلها تظهر مع بعض").
                if (widget.requiresPreciseTime && _selectedDate != null) ...[
                  const SizedBox(height: 12),
                  _ScheduleOptionCard(
                    icon: Icons.schedule_outlined,
                    title: 'الساعة',
                    subtitle: _selectedTime != null
                        ? _selectedTime!.format(context)
                        : 'حدد وقت البداية',
                    selected: _selectedTime != null,
                    onTap: () => _pickTime(context),
                  ),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _canConfirm ? _confirm : null,
                    child: const Text('تأكيد الميعاد'),
                  ),
                ],
                // مكان التنبيه ده هنا مش في شاشة تأكيد الطلب (نقل مقصود، docs/08 §76-و، بلاغ
                // مالك صريح): «الكاستمر بيختار المواعيد من برا، فيه صفحة خاصة بالمواعيد أصلاً…
                // هنشيل دي من هنا ونحطها مع بتاعت اختار معادك». والمنطق يوافق: نصيحة عن
                // استعجال الموعد قيمتها الوحيدة **وقت اختيار الموعد**؛ بعد ما العميل يختار
                // ويوصل للدفع بتبقى مجرد نص بيزحم الشاشة.
                if (_nearTermHours != null && _nearTermHours! > 0) ...[
                  const SizedBox(height: 20),
                  _BookingTimingNotice(nearTermHours: _nearTermHours!),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ScheduleOptionCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool highlighted;
  final bool selected;

  const _ScheduleOptionCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.highlighted = false,
    this.selected = false,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: selected
          ? scheme.primaryContainer
          : (highlighted ? scheme.primaryContainer : null),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Icon(
                icon,
                size: 32,
                color: selected || highlighted
                    ? scheme.onPrimaryContainer
                    : scheme.primary,
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_left),
            ],
          ),
        ),
      ),
    );
  }
}

/// تنبيه سياسة المواعيد (docs/08 §61.3، مختصر docs/08 §87 طلب مالك صريح) — كان فقرة كاملة
/// ("محتاج الخدمة بسرعة؟ لو الموعد عاجل اختار خدمة طوارئ...")، المالك عايزها سطر واحد بسيط
/// بالمعلومة الأساسية بس، بلا مقدمة/شرح إضافي.
class _BookingTimingNotice extends StatelessWidget {
  const _BookingTimingNotice({required this.nearTermHours});

  final int nearTermHours;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Icon(Icons.bolt_outlined, size: 20, color: scheme.primary),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'الطلبات خلال الـ$nearTermHours ساعة الجاية بتحتاج تأكيد الفني الأول.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ],
      ),
    );
  }
}
