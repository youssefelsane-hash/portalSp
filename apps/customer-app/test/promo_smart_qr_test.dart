import 'package:customer_app/features/orders/qr_code_scan_screen.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('codeFromScannedQr', () {
    test('extracts a promo code from the smart public QR link', () {
      expect(
        codeFromScannedQr('https://api.osta.example/p/save_20'),
        'SAVE_20',
      );
    });

    test('keeps existing building and manually printed codes unchanged', () {
      expect(codeFromScannedQr('BLDG-123'), 'BLDG-123');
    });
  });
}
