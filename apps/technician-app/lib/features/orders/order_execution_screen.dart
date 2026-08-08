import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
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
      onError: (message) {
        if (mounted) setState(() => _error = message);
      },
    );
    _trackingConnected = true;
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
