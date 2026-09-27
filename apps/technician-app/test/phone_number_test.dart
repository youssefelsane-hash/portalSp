import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/phone_number.dart';

void main() {
  test('Egyptian mobile prefixes keep the existing E.164 account identity', () {
    for (final prefix in ['010', '011', '012', '015']) {
      final local = '${prefix}12345678';
      expect(isValidPhoneInput(local), isTrue);
      expect(phoneNumberForApi(local), '+20${local.substring(1)}');
      expect(phoneNumberForDisplay(phoneNumberForApi(local)), local);
    }
  });

  test('existing international numbers still work', () {
    expect(phoneNumberForApi('+201001234567'), '+201001234567');
    expect(phoneNumberForApi('+49 151 23456789'), '+4915123456789');
    expect(isValidPhoneInput('+4915123456789'), isTrue);
  });

  test('incomplete or unsupported local numbers never pass validation', () {
    for (final input in [
      '',
      '015',
      '0151234567',
      '015123456789',
      '01312345678',
    ]) {
      expect(isValidPhoneInput(input), isFalse, reason: input);
    }
  });
}
