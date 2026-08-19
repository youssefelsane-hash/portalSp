import 'package:flutter/material.dart';

// "متى تحب تنفيذ الشغل؟" (docs/08 §154، طلب صريح من المالك: "كل حجز لازم يجاوب على السؤال
// ده — مش نسأل هل الفني متاح عمومًا، نسأل هل يقدر ينفّذ في الوقت اللي العميل طالبه بالظبط").
// خطوة إجبارية في تدفق الحجز العادي (فردي/اعتماد) — الطوارئ (docs/06) مستجاب فوري بالتعريف
// فمش بيمرّ بالشاشة دي خالص (orders.service.ts بيرفض scheduled_at مع بوكينج طوارئ بوضوح).
// null (ASAP) نتيجة صحيحة ومقصودة — مش غياب اختيار، هو اختيار العميل الصريح "في أقرب وقت".
class ScheduleChoice {
  final DateTime? scheduledAt;
  const ScheduleChoice.asap() : scheduledAt = null;
  const ScheduleChoice.at(this.scheduledAt);
}

class ScheduleSelectionScreen extends StatelessWidget {
  const ScheduleSelectionScreen({super.key});

  Future<void> _pickToday(BuildContext context) async {
    final now = DateTime.now();
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(now.add(const Duration(hours: 1))),
    );
    if (time == null || !context.mounted) return;
    final chosen = DateTime(now.year, now.month, now.day, time.hour, time.minute);
    if (chosen.isBefore(now.add(const Duration(minutes: 15)))) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('الوقت ده قريب أوي أو فات — اختار وقت بعد ربع ساعة على الأقل')),
      );
      return;
    }
    if (context.mounted) Navigator.of(context).pop(ScheduleChoice.at(chosen));
  }

  Future<void> _pickTomorrow(BuildContext context) async {
    final tomorrow = DateTime.now().add(const Duration(days: 1));
    final time = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 10, minute: 0),
    );
    if (time == null || !context.mounted) return;
    final chosen = DateTime(tomorrow.year, tomorrow.month, tomorrow.day, time.hour, time.minute);
    if (context.mounted) Navigator.of(context).pop(ScheduleChoice.at(chosen));
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
    final time = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 10, minute: 0),
    );
    if (time == null || !context.mounted) return;
    final chosen = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    if (chosen.isBefore(now.add(const Duration(minutes: 15)))) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('الموعد ده فات — اختار موعد في المستقبل')),
      );
      return;
    }
    if (context.mounted) Navigator.of(context).pop(ScheduleChoice.at(chosen));
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
                icon: Icons.bolt,
                title: 'في أقرب وقت ممكن',
                subtitle: 'هنبدأ نبحث عن فني متاح فورًا',
                highlighted: true,
                onTap: () => Navigator.of(context).pop(const ScheduleChoice.asap()),
              ),
              const SizedBox(height: 12),
              _ScheduleOptionCard(
                icon: Icons.today_outlined,
                title: 'النهاردة الساعة كام؟',
                subtitle: 'حدّد وقت النهاردة اللي يناسبك',
                onTap: () => _pickToday(context),
              ),
              const SizedBox(height: 12),
              _ScheduleOptionCard(
                icon: Icons.event_outlined,
                title: 'بكرة الساعة كام؟',
                subtitle: 'حدّد وقت بكرة اللي يناسبك',
                onTap: () => _pickTomorrow(context),
              ),
              const SizedBox(height: 12),
              _ScheduleOptionCard(
                icon: Icons.calendar_month_outlined,
                title: 'تاريخ ووقت تاني',
                subtitle: 'اختار أي يوم/ساعة في المستقبل',
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
