import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_config.dart';

// Script 2 Part J (finding #50) — إصدار Release لازم يفشل فورًا لو لسه شايل عنوان
// Android emulator الافتراضي، مش يشحن صامتًا لجهاز فني حقيقي هيفشل الاتصال بلا تفسير.
void main() {
  group('assertProductionApiConfig — Script 2 Part J', () {
    test('مايرميش استثناء في وضع غير release بغض النظر عن العنوان', () {
      expect(() => assertProductionApiConfig(isRelease: false, url: 'http://10.0.2.2:3000/api/v1'), returnsNormally);
    });

    test('بيرمي استثناء واضح في وضع release لو العنوان لسه 10.0.2.2 (الافتراضي)', () {
      expect(
        () => assertProductionApiConfig(isRelease: true, url: 'http://10.0.2.2:3000/api/v1'),
        throwsA(isA<StateError>()),
      );
    });

    test('بيرمي استثناء في وضع release لو العنوان localhost/127.0.0.1', () {
      expect(() => assertProductionApiConfig(isRelease: true, url: 'http://localhost:3000/api/v1'), throwsA(isA<StateError>()));
      expect(() => assertProductionApiConfig(isRelease: true, url: 'http://127.0.0.1:3000/api/v1'), throwsA(isA<StateError>()));
    });

    test('مايرميش استثناء في وضع release لو العنوان دومين إنتاج حقيقي', () {
      expect(() => assertProductionApiConfig(isRelease: true, url: 'https://api.baytak.app/api/v1'), returnsNormally);
    });
  });
}
