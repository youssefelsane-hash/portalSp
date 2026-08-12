import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../addresses/addresses_screen.dart';
import '../addresses/models.dart';
import '../catalog/models.dart';
import '../orders/create_order_screen.dart';
import 'models.dart';
import 'technician_profile_screen.dart';
import 'technicians_repository.dart';

// اختيار الفني قبل الحجز (docs/08 §1.5) — كانت فجوة موثّقة صراحة: GET /services/:id/technicians
// مختبر حي في الباك-إند من سيشن سابقة بلا أي شاشة تناديه، فالعميل مكانش يقدر يختار فني بعينه
// قبل الحجز أصلاً (auto-match بس). الشاشة دي بتظهر بعد اختيار الخدمة (bookingMode=individual بس
// — team ليها اختيار شركة/فريق منفصل جوّه CreateOrderScreen، emergency بيتوزّع تلقائيًا بالكامل).
class TechnicianSelectionScreen extends StatefulWidget {
  final CatalogService service;

  // سياسة إلغاء الفني (docs/10) — لو اتبعت، الشاشة بتستخدمها بدل التنقل لـCreateOrderScreen
  // (نفس الشاشة، غرض مختلف: اختيار فني بديل لطلب موجود بالفعل، مش إنشاء طلب جديد). null يعني
  // السلوك الأصلي (اختيار فني قبل حجز جديد).
  final void Function(String? requestedTechnicianId)? onManualSelect;

  // سياسة إلغاء الفني (docs/10) — لو اتبعت (وضع إعادة الاختيار)، القايمة مش هتعرض الفني ده.
  final String? excludeTechnicianId;

  const TechnicianSelectionScreen({super.key, required this.service, this.onManualSelect, this.excludeTechnicianId});

  @override
  State<TechnicianSelectionScreen> createState() => _TechnicianSelectionScreenState();
}

class _TechnicianSelectionScreenState extends State<TechnicianSelectionScreen> {
  late final TechniciansRepository _repository;
  Address? _selectedAddress;
  List<TechnicianBookingListItem>? _technicians;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = TechniciansRepository(context.read<AuthRepository>());
    _pickAddress();
  }

  Future<void> _pickAddress() async {
    final address = await Navigator.of(context).push<Address>(
      MaterialPageRoute(builder: (_) => const AddressesScreen(selectionMode: true)),
    );
    if (address == null) {
      // العميل رجع من غير ما يختار عنوان — مفيش داعي نفضل في شاشة فاضية، نرجعه للخلف.
      if (mounted) Navigator.of(context).pop();
      return;
    }
    setState(() {
      _selectedAddress = address;
      _technicians = null;
      _error = null;
    });
    await _load();
  }

  Future<void> _load() async {
    final address = _selectedAddress;
    if (address == null) return;
    setState(() => _loading = true);
    try {
      final items = await _repository.listForService(
        widget.service.id,
        address.id,
        excludeTechnicianId: widget.excludeTechnicianId,
      );
      if (mounted) setState(() => _technicians = items);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _confirmSelection({String? requestedTechnicianId}) {
    if (widget.onManualSelect != null) {
      widget.onManualSelect!(requestedTechnicianId);
      return;
    }
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => CreateOrderScreen(
          service: widget.service,
          bookingMode: BookingMode.individual,
          requestedTechnicianId: requestedTechnicianId,
          initialAddress: _selectedAddress,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text('اختار الفني: ${widget.service.nameAr}')),
        body: _selectedAddress == null
            ? const SizedBox.shrink() // لسه بيختار عنوان (AddressesScreen فوقها)
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Card(
                    color: Theme.of(context).colorScheme.primaryContainer,
                    child: ListTile(
                      leading: const Icon(Icons.bolt),
                      title: const Text('اختار لي تلقائيًا (أسرع)'),
                      subtitle: const Text('هنبعت الطلب لأقرب/أنسب فني متاح فورًا'),
                      trailing: const Icon(Icons.chevron_left),
                      onTap: () => _confirmSelection(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('أو اختار الفني بنفسك', style: Theme.of(context).textTheme.titleMedium),
                      TextButton.icon(
                        onPressed: _pickAddress,
                        icon: const Icon(Icons.edit_location_alt_outlined, size: 18),
                        label: const Text('تغيير العنوان'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (_loading)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 24),
                      child: Center(child: CircularProgressIndicator()),
                    )
                  else if (_error != null)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: Text(_error!, style: const TextStyle(color: Colors.red)),
                    )
                  else if ((_technicians ?? []).isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 12),
                      child: Text('مفيش فنيين متاحين للخدمة دي في منطقتك دلوقتي — استخدم "اختار لي تلقائيًا"'),
                    )
                  else
                    ..._technicians!.map(
                      (t) => Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundImage: t.avatarUrl != null ? NetworkImage(t.avatarUrl!) : null,
                            child: t.avatarUrl == null ? const Icon(Icons.person) : null,
                          ),
                          title: Text(t.fullName),
                          subtitle: Row(
                            children: [
                              if (t.totalRatingsCount > 0) ...[
                                const Icon(Icons.star, size: 14, color: Colors.amber),
                                Text(' ${t.averageRating.toStringAsFixed(1)} (${t.totalRatingsCount})  '),
                              ] else
                                const Text('لسه من غير تقييم  '),
                              Text('· ${t.completedOrdersCount} طلب مكتمل'),
                              if (t.distanceKm != null) Text('  · ${t.distanceKm!.toStringAsFixed(1)} كم'),
                            ],
                          ),
                          isThreeLine: false,
                          trailing: Wrap(
                            spacing: 4,
                            children: [
                              IconButton(
                                tooltip: 'البروفايل الكامل',
                                icon: const Icon(Icons.info_outline),
                                onPressed: () => Navigator.of(context).push(
                                  MaterialPageRoute(builder: (_) => TechnicianProfileScreen(technicianId: t.id)),
                                ),
                              ),
                              FilledButton(
                                onPressed: () => _confirmSelection(requestedTechnicianId: t.id),
                                child: const Text('اختار'),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}
