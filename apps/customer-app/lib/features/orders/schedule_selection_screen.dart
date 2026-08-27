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
class ScheduleChoice {
  final DateTime scheduledAt;
  // "مرن — اختار نطاق أيام" (docs/08 §32.3) — null يعني يوم محدد واحد بس (مفيش نطاق).
  final DateTime? rangeEnd;
  const ScheduleChoice(this.scheduledAt, {this.rangeEnd});
}

// بداية اليوم المحلي (Africa/Cairo، نفس منطقة العمل الوحيدة للمشروع) — نفس التاريخ اللي هيتعرض
// للفني/الأدمن، بلا أي مكون وقت. `DateTime` المحلي هنا كافي (السيرفر بيحوّله UTC عند الإرسال).
DateTime _startOfDay(DateTime date) => DateTime(date.year, date.month, date.day);

// أقصى فرق بين بداية ونهاية النطاق المرن — matching orders.service.ts's اقتصادها بالحرف
// (استعلام أهلية يومي متكرر بحد أقصى، مش نطاق مفتوح).
const int _maxFlexibleRangeDays = 14;

class ScheduleSelectionScreen extends StatefulWidget {
  // قدرة "نطاق أيام مرن" لكل خدمة (ADR-0028، docs/08 §42 Phase A.2) — لو false، كارت "مرن" بيتخفي
  // بدل ما العميل يختاره ويترفض من الباك-إند بعدين (orders.service.ts).
  final bool allowsDateRangeBooking;
  const ScheduleSelectionScreen({super.key, required this.allowsDateRangeBooking});

  @override
  State<ScheduleSelectionScreen> createState() => _ScheduleSelectionScreenState();
}

class _ScheduleSelectionScreenState extends State<ScheduleSelectionScreen> {
  // عتبة "الشغل القريب" بالساعات (docs/08 §61.3) — null لحد ما تتحمّل، و0 معناه الأدمن عطّل
  // النظام ده فمفيش تنبيه يتعرض. فشل التحميل بيسيبها null بهدوء: التنبيه معلومة مساعدة،
  // مايصحّش يمنع العميل من اختيار موعد.
  int? _nearTermHours;

  @override
  void initState() {
    super.initState();
    _loadBookingPolicy();
  }

  // `/booking-policy` عام (`@Public()`) — فالشاشة دي بتقراه بنفسها بدل ما تستنى الشاشة اللي
  // فتحتها تمرّرهولها. ده مهم لأن ليها مدخلين مختلفين (`create_order_screen` و
  // `catalog_navigation`)، وواحد منهم مكانش بيعرف الرقم ده أصلاً.
  Future<void> _loadBookingPolicy() async {
    try {
      final data = await apiRequest('GET', '/booking-policy');
      if (!mounted) return;
      setState(() => _nearTermHours = (data?['near_term_request_hours'] as num?)?.toInt());
    } catch (error) {
      debugPrint('فشل تحميل سياسة المواعيد: $error');
    }
  }

  Future<void> _pickSpecificDate(BuildContext context) async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: now.add(const Duration(days: 2)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 90)),
    );
    if (date == null || !context.mounted) return;
    Navigator.of(context).pop(ScheduleChoice(_startOfDay(date)));
  }

  Future<void> _pickFlexibleRange(BuildContext context) async {
    final now = DateTime.now();
    final range = await showDateRangePicker(
      context: context,
      initialDateRange: DateTimeRange(start: now.add(const Duration(days: 1)), end: now.add(const Duration(days: 4))),
      firstDate: now,
      lastDate: now.add(const Duration(days: 90)),
      helpText: 'اختار نطاق الأيام اللي تناسبك',
    );
    if (range == null || !context.mounted) return;
    final start = _startOfDay(range.start);
    var end = _startOfDay(range.end);
    // العميل يقدر يختار نطاق أوسع من الحد المسموح بيه — بنقصّه للحد الأقصى بدل ما نرفض الاختيار
    // كله ونرجّعه يعيد من الأول (تجربة استخدام أسهل، والنتيجة العملية واحدة: أقرب يوم متاح جوّه
    // أول 14 يوم من اختياره).
    final maxEnd = start.add(const Duration(days: _maxFlexibleRangeDays));
    if (end.isAfter(maxEnd)) end = maxEnd;
    Navigator.of(context).pop(ScheduleChoice(start, rangeEnd: end));
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('امتى تحب تنفّذ الشغل؟')),
        body: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 8),
              _ScheduleOptionCard(
                icon: Icons.calendar_month_outlined,
                title: 'اختار يوم محدد',
                subtitle: 'حدد اليوم اللي يناسبك من الكالندر',
                highlighted: true,
                onTap: () => _pickSpecificDate(context),
              ),
              if (widget.allowsDateRangeBooking) ...[
                const SizedBox(height: 12),
                _ScheduleOptionCard(
                  icon: Icons.event_repeat_outlined,
                  title: 'مرن — اختار نطاق أيام',
                  subtitle: 'هنجيبلك أقرب يوم فيه فني متاح جوّه النطاق اللي تختاره',
                  onTap: () => _pickFlexibleRange(context),
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
    );
  }
}

class _ScheduleOptionCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool highlighted;

  const _ScheduleOptionCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.highlighted = false,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: highlighted ? scheme.primaryContainer : null,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Icon(icon, size: 32, color: highlighted ? scheme.onPrimaryContainer : scheme.primary),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 4),
                    Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
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

/// تنبيه سياسة المواعيد (docs/08 §61.3). نصّه مقصود يكون **مساعد مش تحذيري**: بيقول للعميل
/// إيه أسرع طريق لو مستعجل، وبيطمّنه إن المواعيد الأبعد مش محتاجة انتظار — من غير ما يحسّسه
/// إن الحجز العادي فيه مشكلة.
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
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.bolt_outlined, size: 20, color: scheme.primary),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('محتاج الخدمة بسرعة؟', style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 4),
                Text(
                  'لو الموعد عاجل، اختار خدمة طوارئ. المواعيد العادية خلال الـ$nearTermHours ساعة الجاية '
                  'بتحتاج تأكيد الفني الأول، أما المواعيد بعد كده فمش محتاجة انتظار موافقة إضافية.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
