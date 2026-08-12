import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../chat/chat_screen.dart';
import '../media/media_repository.dart';
import '../tracking/tracking_client.dart';
import 'order.dart';
import 'orders_repository.dart';

// قبل/بعد الشغل — عتبة بسيطة على الحالة بدل قايمة صور فعلية (مفيش GET /technician/orders/:id
// لاسترجاع صور اترفعت قبل كده لو التطبيق اتقفل وفتح تاني، نفس فجوة الاستمرارية الموثّقة فوق).
const Set<String> _beforePhotoStatuses = {'accepted', 'technician_on_way', 'technician_arrived'};
const Set<String> _afterPhotoStatuses = {'in_progress', 'work_completed'};

// نفس ACTIVE_TRACKING_STATUSES في order-tracking.gateway.ts بالظبط.
const Set<String> _activeTrackingStatuses = {'accepted', 'technician_on_way', 'technician_arrived', 'in_progress'};

class OrderExecutionScreen extends StatefulWidget {
  final Order initialOrder;

  const OrderExecutionScreen({super.key, required this.initialOrder});

  @override
  State<OrderExecutionScreen> createState() => _OrderExecutionScreenState();
}

class _OrderExecutionScreenState extends State<OrderExecutionScreen> {
  late final OrdersRepository _repository;
  late final MediaRepository _mediaRepository;
  late final String _accessToken;
  final _trackingClient = TechnicianTrackingClient();
  late Order _order;
  bool _acting = false;
  bool _uploadingPhoto = false;
  bool _trackingConnected = false;
  String? _error;
  String? _photoMessage;

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthRepository>();
    _repository = OrdersRepository(auth);
    _mediaRepository = MediaRepository(auth);
    _accessToken = auth.accessToken!;
    _order = widget.initialOrder;
    _connectTrackingIfActive();
  }

  void _connectTrackingIfActive() {
    if (_trackingConnected || !_activeTrackingStatuses.contains(_order.orderStatus)) return;
    _trackingClient.connect(
      accessToken: _accessToken,
      orderId: _order.id,
      onError: (message) {
        if (mounted) setState(() => _error = message);
      },
      onOrderStatusChanged: (previousStatus, newStatus) => _refreshFromServer(),
    );
    _trackingConnected = true;
  }

  // بتتنادى لما يوصل order:status_changed (docs/08 §15) — أهم سيناريو: العميل وافق/رفض عرض
  // السعر (awaiting_quote_approval → in_progress)، والشاشة كانت هتفضل عارضة كارت العرض المعلّق
  // القديم لحد ما الفني يخرج ويرجع يدوي. فشل التحديث (مشكلة شبكة عابرة) مش لازم يكسر الشاشة —
  // القيمة المحلية بتفضل زي ما هي، والفني لسه يقدر يعمل pull-to-refresh يدوي (لو موجود) أو
  // يخرج ويرجع، نفس السلوك القديم بالظبط.
  Future<void> _refreshFromServer() async {
    try {
      final order = await _repository.getOne(_order.id);
      if (mounted) setState(() => _order = order);
    } on ApiException {
      // تجاهل — راجع التعليق فوق.
    }
  }

  Future<void> _shareLocation() async {
    final latController = TextEditingController();
    final lngController = TextEditingController();
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('شارك موقعك'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: latController,
                decoration: const InputDecoration(labelText: 'خط العرض (latitude)'),
                keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
              ),
              TextField(
                controller: lngController,
                decoration: const InputDecoration(labelText: 'خط الطول (longitude)'),
                keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('إلغاء')),
            FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('إرسال')),
          ],
        ),
      ),
    );
    if (result != true) return;
    final lat = double.tryParse(latController.text.trim());
    final lng = double.tryParse(lngController.text.trim());
    if (lat == null || lng == null) {
      if (mounted) setState(() => _error = 'الإحداثيات لازم تكون أرقام صحيحة');
      return;
    }
    _trackingClient.sendLocation(latitude: lat, longitude: lng);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('اتبعت موقعك للعميل')));
    }
  }

  // كانت فجوة موثّقة صراحة ("ملاحة فعلية — لسه لأ"): بدل ما نبني خريطة توجيه كاملة جوّه
  // التطبيق (تعقيد وتكلفة صيانة كبيرين لميزة تطبيقات الخرائط بتعملها أحسن بكتير)، بنفتح تطبيق
  // خرائط حقيقي (Google Maps مثبّت، وإلا المتصفح) بمسار اتجاهات جاهز لعنوان الطلب مباشرة —
  // نمط شائع ومعتمد في تطبيقات التوصيل المشابهة. رابط Google Maps العام (`/maps/dir/?api=1`)
  // بيشتغل عبر المنصات كلها من غير أي مفتاح API أو إعداد إضافي.
  Future<void> _openNavigation() async {
    final address = _order.address;
    if (address == null) return;
    final uri = Uri.parse(
      'https://www.google.com/maps/dir/?api=1&destination=${address.latitude},${address.longitude}',
    );
    final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!launched && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('مقدرناش نفتح تطبيق الخرائط')));
    }
  }

  @override
  void dispose() {
    _trackingClient.dispose();
    super.dispose();
  }

  Future<void> _uploadPhoto(String mediaType, String labelAr) async {
    final picker = ImagePicker();
    final XFile? picked = await picker.pickImage(source: ImageSource.camera, imageQuality: 85);
    if (picked == null) return;

    setState(() {
      _uploadingPhoto = true;
      _error = null;
      _photoMessage = null;
    });
    try {
      final bytes = await picked.readAsBytes();
      await _mediaRepository.upload(
        orderId: _order.id,
        fileBytes: bytes,
        filename: picked.name,
        mediaType: mediaType,
      );
      if (mounted) setState(() => _photoMessage = 'صورة $labelAr اترفعت ✅');
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _uploadingPhoto = false);
    }
  }

  // كانت فجوة موثّقة صراحة (S7): مفيش UI لمسار عرض السعر أثناء التنفيذ — الباك-إند
  // (order-items.service.ts) والـ endpoint جاهزين ومختبرين حي، هنا أول استهلاك فعلي من التطبيق.
  Future<void> _proposeQuoteItems() async {
    final drafts = await showDialog<List<_QuoteItemDraft>>(
      context: context,
      builder: (context) => const _ProposeQuoteDialog(),
    );
    if (drafts == null || drafts.isEmpty) return;

    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      final items = drafts
          .map((d) => {
                'item_type': d.itemType,
                'name_ar': d.nameAr,
                'quantity': d.quantity,
                'unit_price_cents': d.unitPriceCents,
              })
          .toList();
      _order = await _repository.proposeQuoteItems(_order.id, items);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('اتبعت عرض السعر للعميل — مستني رده')));
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _runAction(String action) async {
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      switch (action) {
        case 'depart':
          _order = await _repository.depart(_order.id);
        case 'arrive':
          _order = await _repository.arrive(_order.id);
        case 'start':
          _order = await _repository.start(_order.id);
        case 'complete':
          _order = await _repository.complete(_order.id);
        case 'collect_cash':
          await _repository.collectCash(_order.id);
          // مفيش GET /technician/orders/:id — الطلب بعد collect-cash بيبقى completed دايماً
          // (نفس المسار الوحيد المتاح، مفيش دفع تاني في التطبيق لسه)، فبنعكسها محلياً.
          _order = Order(
            id: _order.id,
            orderNumber: _order.orderNumber,
            orderStatus: 'completed',
            problemDescription: _order.problemDescription,
            totalAmountCents: _order.totalAmountCents,
            paymentStatus: 'paid',
          );
      }
      if (mounted) setState(() {});
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  @override
  Widget build(BuildContext context) {
    final nextAction = nextTechnicianAction[_order.orderStatus];
    final isDone = _order.orderStatus == 'completed';

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text('طلب ${_order.orderNumber}')),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      technicianOrderStatusLabelsAr[_order.orderStatus] ?? _order.orderStatus,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 8),
                    Text('القيمة: ${_formatEgp(_order.totalAmountCents)}'),
                    if (_order.problemDescription != null) ...[
                      const SizedBox(height: 8),
                      Text('المشكلة: ${_order.problemDescription}'),
                    ],
                  ],
                ),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => ChatScreen(orderId: _order.id)),
              ),
              icon: const Icon(Icons.chat_bubble_outline),
              label: const Text('الشات مع العميل'),
            ),
            if (_photoMessage != null) ...[
              const SizedBox(height: 12),
              Text(_photoMessage!, style: const TextStyle(color: Colors.green)),
            ],
            if (_activeTrackingStatuses.contains(_order.orderStatus)) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: _shareLocation,
                icon: const Icon(Icons.share_location_outlined),
                label: const Text('شارك موقعك مع العميل'),
              ),
              if (_order.address != null) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _openNavigation,
                  icon: const Icon(Icons.navigation_outlined),
                  label: const Text('افتح الملاحة للعنوان'),
                ),
              ],
            ],
            if (_beforePhotoStatuses.contains(_order.orderStatus) ||
                _afterPhotoStatuses.contains(_order.orderStatus)) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: _uploadingPhoto
                    ? null
                    : () => _uploadPhoto(
                          _beforePhotoStatuses.contains(_order.orderStatus) ? 'before_photo' : 'after_photo',
                          _beforePhotoStatuses.contains(_order.orderStatus) ? 'قبل الشغل' : 'بعد الشغل',
                        ),
                icon: const Icon(Icons.camera_alt_outlined),
                label: _uploadingPhoto
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(_beforePhotoStatuses.contains(_order.orderStatus) ? 'صوّر قبل الشغل' : 'صوّر بعد الشغل'),
              ),
            ],
            if (_order.orderStatus == 'in_progress') ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: _acting ? null : _proposeQuoteItems,
                icon: const Icon(Icons.receipt_long_outlined),
                label: const Text('اقترح عرض سعر (قطع غيار/أجرة إضافية)'),
              ),
            ],
            const SizedBox(height: 24),
            if (isDone)
              const Center(child: Text('الطلب اتقفل — شكراً على شغلك 👍'))
            else if (nextAction != null)
              FilledButton(
                onPressed: _acting ? null : () => _runAction(nextAction),
                child: _acting
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(technicianActionLabelsAr[nextAction] ?? nextAction),
              ),
          ],
        ),
      ),
    );
  }
}

class _QuoteItemDraft {
  String itemType;
  String nameAr;
  double quantity;
  int unitPriceCents;

  _QuoteItemDraft({this.itemType = 'spare_part', this.nameAr = '', this.quantity = 1, this.unitPriceCents = 0});
}

const Map<String, String> _quoteItemTypeLabelsAr = {
  'spare_part': 'قطعة غيار',
  'extra_labor': 'أجرة إضافية',
  'addon': 'إضافة',
};

// Dialog بسيط لإضافة بند أو أكتر لعرض السعر — كل بند: النوع، الاسم، الكمية، سعر الوحدة بالجنيه
// (بيتحول لقروش وقت الإرسال، مطابق لباقي التطبيق كله بالقرش).
class _ProposeQuoteDialog extends StatefulWidget {
  const _ProposeQuoteDialog();

  @override
  State<_ProposeQuoteDialog> createState() => _ProposeQuoteDialogState();
}

class _ProposeQuoteDialogState extends State<_ProposeQuoteDialog> {
  final List<_QuoteItemDraft> _drafts = [_QuoteItemDraft()];
  final List<TextEditingController> _nameControllers = [TextEditingController()];
  final List<TextEditingController> _qtyControllers = [TextEditingController(text: '1')];
  final List<TextEditingController> _priceControllers = [TextEditingController()];

  @override
  void dispose() {
    for (final c in [..._nameControllers, ..._qtyControllers, ..._priceControllers]) {
      c.dispose();
    }
    super.dispose();
  }

  void _addRow() {
    setState(() {
      _drafts.add(_QuoteItemDraft());
      _nameControllers.add(TextEditingController());
      _qtyControllers.add(TextEditingController(text: '1'));
      _priceControllers.add(TextEditingController());
    });
  }

  void _removeRow(int index) {
    setState(() {
      _drafts.removeAt(index);
      _nameControllers.removeAt(index).dispose();
      _qtyControllers.removeAt(index).dispose();
      _priceControllers.removeAt(index).dispose();
    });
  }

  void _submit() {
    final result = <_QuoteItemDraft>[];
    for (var i = 0; i < _drafts.length; i++) {
      final name = _nameControllers[i].text.trim();
      final qty = double.tryParse(_qtyControllers[i].text.trim());
      final priceEgp = double.tryParse(_priceControllers[i].text.trim());
      if (name.isEmpty || qty == null || qty <= 0 || priceEgp == null || priceEgp < 0) continue;
      result.add(_QuoteItemDraft(
        itemType: _drafts[i].itemType,
        nameAr: name,
        quantity: qty,
        unitPriceCents: (priceEgp * 100).round(),
      ));
    }
    Navigator.of(context).pop(result);
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: AlertDialog(
        title: const Text('اقترح عرض سعر'),
        content: SizedBox(
          width: 400,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (var i = 0; i < _drafts.length; i++)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: DropdownButtonFormField<String>(
                                initialValue: _drafts[i].itemType,
                                decoration: const InputDecoration(labelText: 'النوع'),
                                items: _quoteItemTypeLabelsAr.entries
                                    .map((e) => DropdownMenuItem(value: e.key, child: Text(e.value)))
                                    .toList(),
                                onChanged: (v) => setState(() => _drafts[i].itemType = v ?? 'spare_part'),
                              ),
                            ),
                            if (_drafts.length > 1)
                              IconButton(
                                onPressed: () => _removeRow(i),
                                icon: const Icon(Icons.delete_outline),
                              ),
                          ],
                        ),
                        TextField(
                          controller: _nameControllers[i],
                          decoration: const InputDecoration(labelText: 'اسم البند'),
                        ),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _qtyControllers[i],
                                decoration: const InputDecoration(labelText: 'الكمية'),
                                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: TextField(
                                controller: _priceControllers[i],
                                decoration: const InputDecoration(labelText: 'سعر الوحدة (ج.م.)'),
                                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              ),
                            ),
                          ],
                        ),
                        if (i < _drafts.length - 1) const Divider(),
                      ],
                    ),
                  ),
                TextButton.icon(
                  onPressed: _addRow,
                  icon: const Icon(Icons.add),
                  label: const Text('بند تاني'),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('إلغاء')),
          FilledButton(onPressed: _submit, child: const Text('ابعت العرض')),
        ],
      ),
    );
  }
}
