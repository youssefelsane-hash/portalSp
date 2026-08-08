import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/auth_repository.dart';
import 'tracking_client.dart';

class TrackingScreen extends StatefulWidget {
  final String orderId;
  final String orderNumber;

  const TrackingScreen({super.key, required this.orderId, required this.orderNumber});

  @override
  State<TrackingScreen> createState() => _TrackingScreenState();
}

class _TrackingScreenState extends State<TrackingScreen> {
  final _client = OrderTrackingClient();
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
        }
      },
      onError: (message) {
        if (mounted) setState(() => _error = message);
      },
    );
  }

  @override
  void dispose() {
    _client.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text('تتبع طلب ${widget.orderNumber}')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_error != null)
                  Text(_error!, style: const TextStyle(color: Colors.red))
                else if (!_joined)
                  const Column(
                    children: [
                      CircularProgressIndicator(),
                      SizedBox(height: 16),
                      Text('بيتصل بخدمة التتبع اللحظي...'),
                    ],
                  )
                else ...[
                  const Icon(Icons.location_on, size: 48, color: Colors.green),
                  const SizedBox(height: 16),
                  const Text('متصل — في انتظار تحديث موقع الفني'),
                  if (_lastUpdate != null) ...[
                    const SizedBox(height: 24),
                    Text('آخر موقع معروف:', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Text('خط العرض: ${_lastUpdate!.latitude.toStringAsFixed(5)}'),
                    Text('خط الطول: ${_lastUpdate!.longitude.toStringAsFixed(5)}'),
                    if (_lastUpdateAt != null)
                      Text(
                        'آخر تحديث: ${_lastUpdateAt!.hour.toString().padLeft(2, '0')}:${_lastUpdateAt!.minute.toString().padLeft(2, '0')}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                  ],
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
