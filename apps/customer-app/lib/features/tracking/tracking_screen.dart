import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:provider/provider.dart';
import '../../core/auth_repository.dart';
import '../orders/models.dart';
import 'tracking_client.dart';

class TrackingScreen extends StatefulWidget {
  final String orderId;
  final String orderNumber;
  /// عنوان الوصول (وجهة الفني) — بيظهر كـ marker ثابت على الخريطة لو موجود. اختياري عشان
  /// الشاشة تفضل شغالة حتى لو الطلب المُمرَّر من غير عنوان (احتياط، نادر عملياً).
  final OrderAddress? destination;

  const TrackingScreen({super.key, required this.orderId, required this.orderNumber, this.destination});

  @override
  State<TrackingScreen> createState() => _TrackingScreenState();
}

class _TrackingScreenState extends State<TrackingScreen> {
  final _client = OrderTrackingClient();
  final _mapController = Completer<GoogleMapController>();
  bool _joined = false;
  String? _error;
  TrackingUpdate? _lastUpdate;
  DateTime? _lastUpdateAt;

  @override
  void initState() {
    super.initState();
    final accessToken = context.read<AuthRepository>().accessToken;
    if (accessToken == null) {
      _error = 'مفيش جلسة نشطة';
      return;
    }
    _client.connect(
      accessToken: accessToken,
      orderId: widget.orderId,
      onJoined: () {
        if (mounted) setState(() => _joined = true);
      },
      onLocationUpdate: (update) {
        if (mounted) {
          setState(() {
            _lastUpdate = update;
            _lastUpdateAt = DateTime.now();
          });
          _animateCameraToUpdate(update);
        }
      },
      onError: (message) {
        if (mounted) setState(() => _error = message);
      },
    );
  }

  Future<void> _animateCameraToUpdate(TrackingUpdate update) async {
    if (!_mapController.isCompleted) return;
    final controller = await _mapController.future;
    await controller.animateCamera(
      CameraUpdate.newLatLng(LatLng(update.latitude, update.longitude)),
    );
  }

  @override
  void dispose() {
    _client.dispose();
    super.dispose();
  }

  Set<Marker> get _markers {
    final markers = <Marker>{};
    if (_lastUpdate != null) {
      markers.add(
        Marker(
          markerId: const MarkerId('technician'),
          position: LatLng(_lastUpdate!.latitude, _lastUpdate!.longitude),
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
          infoWindow: const InfoWindow(title: 'الفني'),
        ),
      );
    }
    final destination = widget.destination;
    if (destination != null) {
      markers.add(
        Marker(
          markerId: const MarkerId('destination'),
          position: LatLng(destination.latitude, destination.longitude),
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
          infoWindow: InfoWindow(title: 'عنوانك', snippet: destination.streetName),
        ),
      );
    }
    return markers;
  }

  @override
  Widget build(BuildContext context) {
    final initialPosition = widget.destination != null
        ? LatLng(widget.destination!.latitude, widget.destination!.longitude)
        : (_lastUpdate != null ? LatLng(_lastUpdate!.latitude, _lastUpdate!.longitude) : null);

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text('تتبع طلب ${widget.orderNumber}')),
        body: _error != null
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(_error!, style: const TextStyle(color: Colors.red)),
                ),
              )
            : Column(
                children: [
                  if (!_joined)
                    const Padding(
                      padding: EdgeInsets.all(12),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                          SizedBox(width: 12),
                          Text('بيتصل بخدمة التتبع اللحظي...'),
                        ],
                      ),
                    )
                  else if (_lastUpdate == null)
                    const Padding(
                      padding: EdgeInsets.all(12),
                      child: Text('متصل — في انتظار تحديث موقع الفني'),
                    ),
                  Expanded(
                    child: initialPosition == null
                        ? const Center(child: Text('مفيش إحداثيات كافية لعرض الخريطة لسه'))
                        : GoogleMap(
                            initialCameraPosition: CameraPosition(target: initialPosition, zoom: 14),
                            markers: _markers,
                            myLocationButtonEnabled: false,
                            onMapCreated: (controller) {
                              if (!_mapController.isCompleted) _mapController.complete(controller);
                            },
                          ),
                  ),
                  if (_lastUpdateAt != null)
                    Padding(
                      padding: const EdgeInsets.all(8),
                      child: Text(
                        'آخر تحديث: ${_lastUpdateAt!.hour.toString().padLeft(2, '0')}:${_lastUpdateAt!.minute.toString().padLeft(2, '0')}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}
