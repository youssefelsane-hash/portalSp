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

  // عنوان الموقع — بَقّة حقيقية (بلاغ المالك 2026-09-11: الروابط الخارجية مابتفتحش حاجة).
  // الاشتقاق القديم كان بيشيل `/api/v1` وخلاص، فبيرجّع **عنوان الباك-إند**:
  // `https://api.ostahome.com/legal/terms` = 404 من NestJS. الموقع الحقيقي `ostahome.com`.
  group('deriveSiteBaseUrl', () {
    test('بيشيل بادئة api. في الإنتاج', () {
      expect(deriveSiteBaseUrl('https://api.ostahome.com/api/v1'), 'https://ostahome.com');
    });

    test('بيحوّل منفذ الباك-إند المحلي (3000) لمنفذ الموقع (3002)', () {
      expect(deriveSiteBaseUrl('http://10.0.2.2:3000/api/v1'), 'http://10.0.2.2:3002');
      expect(deriveSiteBaseUrl('http://localhost:3000/api/v1'), 'http://localhost:3002');
    });

    test('مابيلمسش دومين مالوش بادئة api. ولا منفذ 3000', () {
      expect(deriveSiteBaseUrl('https://ostahome.com/api/v1'), 'https://ostahome.com');
      expect(deriveSiteBaseUrl('https://backend.example.com:8443/api/v1'), 'https://backend.example.com:8443');
    });

    test('بيشيل الشرطة المايلة الأخيرة وبيتعامل مع نسخة API تانية', () {
      expect(deriveSiteBaseUrl('https://api.ostahome.com/api/v2/'), 'https://ostahome.com');
    });

    test('مدخل باظ بيرجع زي ما هو بدل ما يرمي', () {
      expect(deriveSiteBaseUrl('مش-رابط'), 'مش-رابط');
    });
  });

  // إصدار Release بعنوان API حقيقي بس عنوان موقع محلي = كل الروابط القانونية مكسورة،
  // وGoogle Play بيطلب نفس الروابط دي في Store Listing.
  group('assertProductionApiConfig — عنوان الموقع', () {
    test('بيرمي لو الموقع لسه محلي رغم إن الـAPI حقيقي', () {
      expect(
        () => assertProductionApiConfig(
          isRelease: true,
          url: 'https://api.ostahome.com/api/v1',
          site: 'http://localhost:3002',
        ),
        throwsA(isA<StateError>()),
      );
    });

    test('بيعدّي لما الاتنين حقيقيين', () {
      expect(
        () => assertProductionApiConfig(isRelease: true, url: 'https://api.ostahome.com/api/v1'),
        returnsNormally,
      );
    });
  });
}
