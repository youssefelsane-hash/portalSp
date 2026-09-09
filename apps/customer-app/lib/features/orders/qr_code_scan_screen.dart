import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// روابط QR لأكواد الخصم (`/p/CODE`) تُرجع الكود للتدفق الحالي؛ الـAPI يراجع صلاحيته عند الحجز.
String codeFromScannedQr(String rawValue) {
  final value = rawValue.trim();
  final uri = Uri.tryParse(value);
  final segments = uri?.pathSegments ?? const <String>[];
  if (segments.length >= 2 && segments[segments.length - 2] == 'p') {
    final code = segments.last.trim();
    if (RegExp(r'^[A-Za-z0-9_-]{3,24}$').hasMatch(code)) return code.toUpperCase();
  }
  return value;
}

/// ماسح محدود الغرض: يرجع النص المرمّز فقط، والتحقق من صلاحية الكود يظل مسؤولية الـAPI.
class QrCodeScanScreen extends StatefulWidget {
  const QrCodeScanScreen({super.key});

  @override
  State<QrCodeScanScreen> createState() => _QrCodeScanScreenState();
}

class _QrCodeScanScreenState extends State<QrCodeScanScreen> {
  final MobileScannerController _controller = MobileScannerController();
  bool _completed = false;

  void _onDetect(BarcodeCapture capture) {
    if (_completed) return;
    final value = capture.barcodes
        .map((barcode) => barcode.rawValue?.trim())
        .whereType<String>()
        .firstWhere((code) => code.isNotEmpty, orElse: () => '');
    if (value.isEmpty) return;

    _completed = true;
    unawaited(_controller.stop());
    Navigator.of(context).pop(codeFromScannedQr(value));
  }

  @override
  void dispose() {
    unawaited(_controller.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('امسح كود الخصم أو العمارة')),
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(controller: _controller, onDetect: _onDetect),
          IgnorePointer(
            child: Center(
              child: Container(
                width: 240,
                height: 240,
                decoration: BoxDecoration(
                  border: Border.all(color: Colors.white, width: 3),
                  borderRadius: BorderRadius.circular(24),
                ),
              ),
            ),
          ),
          const Positioned(
            left: 24,
            right: 24,
            bottom: 48,
            child: Text(
              'وجّه الكاميرا إلى رمز QR، وسنكتب الكود ونتحقق منه تلقائيًا.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
