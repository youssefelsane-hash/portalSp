import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/auth_repository.dart';
import '../addresses/addresses_repository.dart';
import '../addresses/addresses_screen.dart';
import '../addresses/models.dart';

/// رأس الشاشة الرئيسية: «العنوان اللي بيخدمك دلوقتي» (docs/08 §75-ب).
///
/// **طلب المالك**: «فوق خالص يبقى العنوان إن الـcustomer بينتمي لي» — يعني أول حاجة العميل
/// يشوفها هي مكانه هو، مش اسم الشركة. ده معيار في كل تطبيقات الخدمات المعروفة، والسبب سلوكي:
/// السعر والتوفّر والفنيين كلهم بيعتمدوا على المكان، فعرضه فوق بيمنع أهم سوء فهم ممكن يحصل
/// («ليه السعر كده؟» / «ليه مفيش فنيين؟»).
///
/// **مفيش حالة "بيحمّل" مزعجة**: لحد ما العنوان يوصل بيتعرض نص محايد («اختار عنوانك») بدل
/// هيكل عظمي بيومض في أول حاجة العميل بيبص عليها.
class HomeLocationHeader extends StatefulWidget {
  const HomeLocationHeader({super.key, this.onAddressChanged});

  /// بيتنادى لما العميل يغيّر العنوان — الشاشة الأم ممكن تعيد تحميل أي حاجة معتمدة على المكان.
  final ValueChanged<Address?>? onAddressChanged;

  @override
  State<HomeLocationHeader> createState() => _HomeLocationHeaderState();
}

class _HomeLocationHeaderState extends State<HomeLocationHeader> {
  late final AddressesRepository _repository;
  Address? _address;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _repository = AddressesRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final addresses = await _repository.list();
      if (!mounted) return;
      setState(() {
        // العنوان الافتراضي هو اللي بيتحجز عليه فعليًا؛ لو مفيش افتراضي، أول واحد.
        _address = addresses.isEmpty
            ? null
            : addresses.firstWhere((a) => a.isDefault, orElse: () => addresses.first);
        _loaded = true;
      });
    } catch (_) {
      // فشل تحميل العنوان ما ينفعش يمنع العميل من تصفح الخدمات — بيفضل النص المحايد.
      if (mounted) setState(() => _loaded = true);
    }
  }

  Future<void> _pickAddress() async {
    final picked = await Navigator.of(context).push<Address>(
      MaterialPageRoute(builder: (_) => const AddressesScreen(selectionMode: true)),
    );
    if (!mounted) return;
    if (picked != null) {
      setState(() => _address = picked);
      widget.onAddressChanged?.call(picked);
    } else {
      // رجع من غير اختيار — ممكن يكون أضاف/عدّل عنوان، فبنعيد القراءة بدل ما نعرض قديم.
      await _load();
      if (mounted) widget.onAddressChanged?.call(_address);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final address = _address;
    final label = !_loaded
        ? 'اختار عنوانك'
        : address == null
            ? 'أضف عنوانك عشان نعرف نوصلك'
            : address.displayTitle;

    return InkWell(
      onTap: _pickAddress,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
        child: Row(
          children: [
            Icon(Icons.location_on_outlined, size: 20, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'الخدمة هتوصل لـ',
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ),
            Icon(Icons.expand_more_rounded, size: 20, color: theme.colorScheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }
}
