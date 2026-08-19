import 'package:flutter/material.dart';

// "امتى تحب تنفّذ الشغل؟" (docs/08 §154، ADR-0018 §2) — العميل بيختار يوم بس، مش ساعة محددة.
// **تصحيح (ADR-0018 §2)**: النسخة الأولى من الشاشة دي كانت بتاخد ساعة محددة كمان ("النهاردة
// الساعة كام؟") — ده يخالف قصد المالك الصريح: "العميل بيختار اليوم، مش بيوعد الفني بساعة معينة
// (2:30، 5:15). المطابقة بتسأل: الفني ده يقدر ياخد شغلانة تانية في اليوم ده؟ مش بتعتمد على
// سلوتات دقيقة بالدقيقة." الباك-إند لسه بيخزّن scheduled_at كـtimestamp (فايدة تقنية للفرز/الحسابات
// الداخلية)، لكن قيمته دايمًا بداية اليوم المطلوب — العميل ميختارش وقت خالص من هنا.
// خطوة إجبارية في تدفق الحجز العادي (فردي/اعتماد) — الطوارئ مستجابة فورية بالتعريف فمش بتمرّ
// بالشاشة دي خالص (orders.service.ts بيرفض scheduled_at مع بوكينج طوارئ بوضوح).
// null (ASAP) نتيجة صحيحة ومقصودة — مش غياب اختيار، هو اختيار العميل الصريح "في أقرب وقت".
class ScheduleChoice {
  final DateTime? scheduledAt;
  const ScheduleChoice.asap() : scheduledAt = null;
  const ScheduleChoice.at(this.scheduledAt);
}

// بداية اليوم المحلي (Africa/Cairo، نفس منطقة العمل الوحيدة للمشروع) — نفس التاريخ اللي هيتعرض
// للفني/الأدمن، بلا أي مكون وقت. `DateTime` المحلي هنا كافي (السيرفر بيحوّله UTC عند الإرسال).
DateTime _startOfDay(DateTime date) => DateTime(date.year, date.month, date.day);

class ScheduleSelectionScreen extends StatelessWidget {
  const ScheduleSelectionScreen({super.key});

  Future<void> _pickSpecificDate(BuildContext context) async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: now.add(const Duration(days: 2)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 90)),
    );
    if (date == null || !context.mounted) return;
    Navigator.of(context).pop(ScheduleChoice.at(_startOfDay(date)));
  }

  @override
  Widget build(BuildContext context) {
    final today = _startOfDay(DateTime.now());
    final tomorrow = today.add(const Duration(days: 1));
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
                icon: Icons.bolt,
                title: 'في أقرب وقت ممكن',
                subtitle: 'هنبدأ نبحث عن فني متاح فورًا',
                highlighted: true,
                onTap: () => Navigator.of(context).pop(const ScheduleChoice.asap()),
              ),
              const SizedBox(height: 12),
              _ScheduleOptionCard(
                icon: Icons.today_outlined,
                title: 'النهاردة',
                subtitle: 'هيوصلك الفني خلال النهاردة',
                onTap: () => Navigator.of(context).pop(ScheduleChoice.at(today)),
              ),
              const SizedBox(height: 12),
              _ScheduleOptionCard(
                icon: Icons.event_outlined,
                title: 'بكرة',
                subtitle: 'هيوصلك الفني بكرة',
                onTap: () => Navigator.of(context).pop(ScheduleChoice.at(tomorrow)),
              ),
              const SizedBox(height: 12),
              _ScheduleOptionCard(
                icon: Icons.calendar_month_outlined,
                title: 'يوم تاني',
                subtitle: 'اختار أي يوم في المستقبل',
                onTap: () => _pickSpecificDate(context),
              ),
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
