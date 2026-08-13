import 'dart:async';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

// نفس نمط pin ثابت في نص الخريطة والمستخدم بيحرك الخريطة تحته (زي تطبيقات التوصيل المشابهة)
// بدل ما يدوّس على نقطة على الخريطة — أدق وأسهل على شاشة موبايل صغيرة.
const _defaultPosition = LatLng(30.0444, 31.2357); // القاهرة — افتراضي لو تعذّر تحديد الموقع

class AddressMapPickerScreen extends StatefulWidget {
  final double? initialLatitude;
  final double? initialLongitude;

  const AddressMapPickerScreen({super.key, this.initialLatitude, this.initialLongitude});

  @override
  State<AddressMapPickerScreen> createState() => _AddressMapPickerScreenState();
}

class _AddressMapPickerScreenState extends State<AddressMapPickerScreen> {
  final _mapController = Completer<GoogleMapController>();
  late LatLng _picked;
  bool _locating = false;
  String? _locationError;

  @override
  void initState() {
    super.initState();
    _picked = widget.initialLatitude != null && widget.initialLongitude != null
        ? LatLng(widget.initialLatitude!, widget.initialLongitude!)
        : _defaultPosition;
    if (widget.initialLatitude == null) _useCurrentLocation(animateOnly: false);
  }

  Future<void> _useCurrentLocation({bool animateOnly = true}) async {
    setState(() {
      _locating = true;
      _locationError = null;
    });
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        setState(() => _locationError = 'خدمة تحديد الموقع مقفولة على جهازك');
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        setState(() => _locationError = 'محتاجين إذن الوصول لموقعك عشان نحدده على الخريطة');
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      final target = LatLng(position.latitude, position.longitude);
      setState(() => _picked = target);
      if (_mapController.isCompleted) {
        final controller = await _mapController.future;
        await controller.animateCamera(CameraUpdate.newLatLngZoom(target, 16));
      }
    } catch (_) {
      if (animateOnly) setState(() => _locationError = 'مقدرناش نحدد موقعك الحالي');
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('حدد موقعك على الخريطة'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(_picked),
              child: const Text('تأكيد الموقع', style: TextStyle(color: Colors.white)),
            ),
          ],
        ),
        body: Stack(
          alignment: Alignment.center,
          children: [
            GoogleMap(
              initialCameraPosition: CameraPosition(target: _picked, zoom: 15),
              onMapCreated: (controller) {
                if (!_mapController.isCompleted) _mapController.complete(controller);
              },
              onCameraMove: (position) => _picked = position.target,
              myLocationButtonEnabled: false,
            ),
            const Padding(
              padding: EdgeInsets.only(bottom: 36),
              child: Icon(Icons.location_pin, size: 44, color: Colors.red),
            ),
            if (_locationError != null)
              Positioned(
                top: 12,
                left: 12,
                right: 12,
                child: Material(
                  color: Colors.red.shade50,
                  borderRadius: BorderRadius.circular(8),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(_locationError!, style: TextStyle(color: Colors.red.shade900)),
                  ),
                ),
              ),
          ],
        ),
        floatingActionButton: FloatingActionButton(
          onPressed: _locating ? null : _useCurrentLocation,
          child: _locating
              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.my_location),
        ),
      ),
    );
  }
}
