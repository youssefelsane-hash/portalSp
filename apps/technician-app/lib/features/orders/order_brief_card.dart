import 'package:flutter/material.dart';

import '../../core/external_links.dart';
import 'order.dart';
import 'order_context_badges.dart';

/// «الشغلانة دي إيه ولمين؟» (docs/08 §56 بند 3، وإعادة ترتيب docs/08 §185).
///
/// الترتيب **حسب اللي مقدم الخدمة محتاجه بالترتيب ده** (طلب مالك صريح):
/// الخدمة ← الموعد ← معلومة التنفيذ (المدة) ← المطلوب ← اختيارات العميل ← ملاحظات العميل ←
/// بيانات العميل ← العنوان كامل ← الملاحة. قبل كده كل ده كان بنفس الوزن البصري، واختيارات
/// العميل فقرة واحدة، والعنوان سطر شارع وعلامة بس.
///
/// أي جزء فاضي مابيترسمش خالص — مفيش عنوان قسم فوق فراغ ولا «الدور: —».
class OrderBriefCard extends StatelessWidget {
  const OrderBriefCard({super.key, required this.order, this.onNavigate});

  final Order order;

  /// `null` = مفيش عنوان بإحداثيات، فزرار الملاحة مابيظهرش.
  final VoidCallback? onNavigate;

  /// الجدولة باليوم مش بالساعة (ADR-0018 §2) — `scheduled_at` لخدمة عادية = بداية اليوم بالظبط،
  /// فعرض "12:00 ص" هيبقى كذب مش معلومة. الوقت بيتعرض بس لو الخدمة فعلاً طلبت وقت محدد
  /// (أوضاع ADR-0032)، واللي بيميّزها إن الوقت مش منتصف الليل.
  static String formatSchedule(String? iso) {
    if (iso == null) return 'في أقرب وقت (فوري)';
    final at = DateTime.tryParse(iso)?.toLocal();
    if (at == null) return 'في أقرب وقت (فوري)';
    final day =
        '${at.year}/${at.month.toString().padLeft(2, '0')}/${at.day.toString().padLeft(2, '0')}';
    if (at.hour == 0 && at.minute == 0) {
      return '$day (اليوم كله — مفيش ساعة محددة)';
    }
    return '$day الساعة ${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final duration = formatOrderDurationAr(
      durationMinutes: order.durationMinutes,
      estimatedDurationDays: order.estimatedDurationDays,
    );
    final badges = orderContextBadges(
      isRecurring: order.isRecurring,
      isWarrantyRevisit: order.isWarrantyRevisit,
    );
    final problem = order.problemDescription?.trim();
    final notes = order.customerNotes;
    final address = order.address;
    final inputs = CustomerInputsSummary.from(order.customerInputs);

    final sections = <Widget>[
      if (problem != null && problem.isNotEmpty)
        _BriefSection(title: 'المطلوب', child: Text(problem)),
      if (!inputs.isEmpty)
        _BriefSection(
          title: 'اختيارات العميل',
          child: CustomerInputsList(summary: inputs),
        ),
      if (notes != null)
        _BriefSection(
          title: 'ملاحظات العميل',
          child: _Highlighted(child: Text(notes)),
        ),
      // بيانات التواصل بترجع من الباك-إند بس بعد تأكيد الحجز — قبل كده بتبقى null والقسم ده
      // بيختفي بالكامل بدل ما يعرض سطر فاضي.
      if (order.customerName != null)
        _BriefSection(
          title: 'بيانات العميل',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _IconLine(
                icon: Icons.person_outline,
                child: Text(order.customerName!, style: theme.textTheme.titleSmall),
              ),
              if (order.customerPhone != null)
                _PhoneLine(phone: order.customerPhone!),
            ],
          ),
        ),
      if (address != null)
        _BriefSection(
          title: 'العنوان',
          child: OrderAddressDetails(address: address, onNavigate: onNavigate),
        ),
    ];

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // شارات سياق الطلب فوق الاسم مباشرةً — أول حاجة الفني يشوفها لما يفتح الطلب
            // (بلاغ مالك 2026-09-21).
            if (badges.isNotEmpty) ...[
              Wrap(spacing: 6, runSpacing: 4, children: badges),
              const SizedBox(height: 8),
            ],
            Text(
              order.serviceNameAr ?? 'طلب خدمة',
              style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
            ),
            if (order.assignedCompanyName != null) ...[
              const SizedBox(height: 6),
              _IconLine(
                icon: Icons.business_outlined,
                child: Text('الطلب تابع لشركة: ${order.assignedCompanyName}'),
              ),
            ],
            const SizedBox(height: 8),
            _IconLine(
              icon: Icons.event_outlined,
              child: Text(
                formatSchedule(order.scheduledAt),
                style: theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600),
              ),
            ),
            if (duration != null)
              _IconLine(
                icon: Icons.timer_outlined,
                child: Text('المدة المتوقعة للتنفيذ: $duration'),
              ),
            for (final section in sections) ...[
              const Divider(height: 28),
              section,
            ],
          ],
        ),
      ),
    );
  }
}

/// عنوان قسم خفيف + محتواه. الوزن البصري للعنوان أقل من المحتوى عمدًا: مقدم الخدمة بيدوّر على
/// القيمة، والعنوان مجرد علامة.
class _BriefSection extends StatelessWidget {
  const _BriefSection({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          title,
          style: theme.textTheme.labelLarge?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 8),
        child,
      ],
    );
  }
}

class _IconLine extends StatelessWidget {
  const _IconLine({required this.icon, required this.child});

  final IconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Icon(icon, size: 18),
          ),
          const SizedBox(width: 8),
          Expanded(child: child),
        ],
      ),
    );
  }
}

class _PhoneLine extends StatelessWidget {
  const _PhoneLine({required this.phone, this.label});

  final String phone;
  final String? label;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Icon(Icons.phone_outlined, size: 18),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (label != null) Text(label!),
              // الرقم LTR جوّه واجهة RTL: من غيره «+201000000000» كان بيطلع «201000000000+».
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: Text(phone, textDirection: TextDirection.ltr),
              ),
            ],
          ),
        ),
        TextButton.icon(
          onPressed: () => openPhoneDialer(context, phone),
          icon: const Icon(Icons.call, size: 18),
          label: const Text('اتصل'),
        ),
      ],
    );
  }
}

/// ملاحظات العميل مكتوبة بإيده لمقدم الخدمة («الجرس مش شغال») — خلفية خفيفة عشان ماتضيعش
/// وسط القيم الجاهزة.
class _Highlighted extends StatelessWidget {
  const _Highlighted({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.secondaryContainer.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(12),
      ),
      child: child,
    );
  }
}

/// العنوان كامل: الشارع ← العمارة/الدور/الشقة ← علامة مميزة ← ملاحظات الوصول ← المستلم ←
/// الملاحة. أي حقل فاضي (عنوان قديم، أو برّه سياسة الظهور) مالوش صف.
class OrderAddressDetails extends StatelessWidget {
  const OrderAddressDetails({super.key, required this.address, this.onNavigate});

  final OrderAddress address;
  final VoidCallback? onNavigate;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    Widget labeled(String label, String value) => Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [Text(label, style: muted), Text(value)],
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _IconLine(
          icon: Icons.location_on_outlined,
          child: Text(
            address.streetName,
            style: theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600),
          ),
        ),
        if (address.unitLine != null)
          Padding(
            padding: const EdgeInsetsDirectional.only(start: 26),
            child: Text(address.unitLine!),
          ),
        if (address.landmark != null) labeled('علامة مميزة', address.landmark!),
        if (address.deliveryNotes != null)
          labeled('ملاحظات الوصول', address.deliveryNotes!),
        if (address.contactName != null || address.contactPhone != null) ...[
          const SizedBox(height: 8),
          Text('المستلم في العنوان', style: muted),
          if (address.contactPhone != null)
            _PhoneLine(phone: address.contactPhone!, label: address.contactName)
          else
            Text(address.contactName!),
        ],
        if (onNavigate != null) ...[
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: onNavigate,
            icon: const Icon(Icons.navigation_outlined),
            label: const Text('افتح الملاحة للعنوان'),
          ),
        ],
      ],
    );
  }
}

/// اختيارات العميل كصفوف «السؤال … الإجابة». الافتراضي مطوي ورا «عرض الكل» — مش ممسوح.
class CustomerInputsList extends StatefulWidget {
  const CustomerInputsList({super.key, required this.summary});

  final CustomerInputsSummary summary;

  @override
  State<CustomerInputsList> createState() => _CustomerInputsListState();
}

class _CustomerInputsListState extends State<CustomerInputsList> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final summary = widget.summary;
    final meaningful = summary.meaningful;
    // من غير metadata (طلب قديم) كله «meaningful» — بنطوي بعد عدد معقول بدل فقرة بطول الشاشة.
    final collapsedMeaningful =
        !_expanded && meaningful.length > kCollapsedCustomerInputsCount + 1
        ? meaningful.take(kCollapsedCustomerInputsCount).toList()
        : meaningful;
    final hiddenCount = summary.total - collapsedMeaningful.length;
    final showDefaults = _expanded && summary.defaults.isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (meaningful.isEmpty)
          Text(
            'العميل ساب كل الاختيارات على الإعداد الافتراضي.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        for (final item in collapsedMeaningful) _InputRow(item: item),
        if (showDefaults) ...[
          const SizedBox(height: 8),
          Text(
            'على الإعداد الافتراضي',
            style: theme.textTheme.labelMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          for (final item in summary.defaults) _InputRow(item: item, muted: true),
        ],
        if (hiddenCount > 0 || _expanded)
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton(
              onPressed: () => setState(() => _expanded = !_expanded),
              child: Text(
                _expanded ? 'اعرض المختصر' : 'عرض كل الاختيارات (${summary.total})',
              ),
            ),
          ),
      ],
    );
  }
}

class _InputRow extends StatelessWidget {
  const _InputRow({required this.item, this.muted = false});

  final CustomerInputItem item;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final labelStyle = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final valueStyle = theme.textTheme.bodyMedium?.copyWith(
      fontWeight: muted ? FontWeight.w400 : FontWeight.w700,
      color: muted ? theme.colorScheme.onSurfaceVariant : null,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(flex: 3, child: Text(bidiSafeText(item.label), style: labelStyle)),
          const SizedBox(width: 12),
          Flexible(
            flex: 2,
            child: Text(
              bidiSafeText(item.displayValueWithUnit),
              style: valueStyle,
              textAlign: TextAlign.end,
            ),
          ),
        ],
      ),
    );
  }
}
