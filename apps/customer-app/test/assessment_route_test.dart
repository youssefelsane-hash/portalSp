import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/features/catalog/models.dart';
import 'package:customer_app/features/orders/assessment_route.dart';

/// اختبار مصفوفة سياسات التقييم (docs/08 §124) — نفس الأربع سياسات × مسارين اللي
/// `assessment-route-guard.spec.ts` بيغطيها في الباك-إند بالظبط. أي فرق بين النتيجتين
/// معناه العميل هيشوف اختيار مسموح له من التطبيق ومرفوض من الباك-إند (طريق مسدود)، أو
/// العكس — مسار مسموح بيه فعليًا ومختفي عن العميل.
CatalogService _service({
  required String priceCertaintyMode,
  required String assessmentRoutePolicy,
  required bool remoteAssessmentEnabled,
  required bool onsiteAssessmentEnabled,
  String pricingModel = 'inspection_then_quote',
}) => CatalogService(
  id: 's1',
  categoryId: 'c1',
  nameAr: 'خدمة اختبار',
  shortDescriptionAr: null,
  iconUrl: null,
  pricingModel: pricingModel,
  priceCertaintyMode: priceCertaintyMode,
  assessmentRoutePolicy: assessmentRoutePolicy,
  remoteAssessmentEnabled: remoteAssessmentEnabled,
  onsiteAssessmentEnabled: onsiteAssessmentEnabled,
  basePriceCents: 0,
  inspectionFeeCents: 15000,
  allowsScheduling: true,
  allowsEmergency: false,
  allowsIndividual: true,
  allowsTeam: false,
  allowsDateRangeBooking: false,
  allowsRecurringBooking: false,
  cashAllowed: true,
  schedulePrecision: 'full_day',
);

void main() {
  group('AssessmentRoutes.forService — مصفوفة الأربع سياسات', () {
    test('سعر مؤكد أو نطاق تقديري: مفيش مسار تقييم أصلاً', () {
      final r = AssessmentRoutes.forService(
        _service(
          priceCertaintyMode: 'confirmed_price',
          assessmentRoutePolicy: 'admin_triage',
          remoteAssessmentEnabled: true,
          onsiteAssessmentEnabled: true,
        ),
      );
      expect(r.remote, isFalse);
      expect(r.onsite, isFalse);
    });

    test('admin_triage + المسارين مفعّلين: العميل عنده اختيار', () {
      final r = AssessmentRoutes.forService(
        _service(
          priceCertaintyMode: 'assessment_required',
          assessmentRoutePolicy: 'admin_triage',
          remoteAssessmentEnabled: true,
          onsiteAssessmentEnabled: true,
        ),
      );
      expect(r.remote, isTrue);
      expect(r.onsite, isTrue);
      expect(r.hasChoice, isTrue);
    });

    test('remote_only: بالصور بس، معاينة الموقع مقفولة — نفس الباك-إند بعد إصلاح §124-B', () {
      final r = AssessmentRoutes.forService(
        _service(
          priceCertaintyMode: 'assessment_required',
          assessmentRoutePolicy: 'remote_only',
          remoteAssessmentEnabled: true,
          onsiteAssessmentEnabled: true, // الأدمن سايبه true بالغلط — السياسة لازم تغلبه
        ),
      );
      expect(r.remote, isTrue);
      expect(r.onsite, isFalse, reason: 'remote_only لازم تقفل مسار المعاينة حتى لو العلم شغّال');
    });

    test('onsite_only: معاينة بس، الصور مقفولة', () {
      final r = AssessmentRoutes.forService(
        _service(
          priceCertaintyMode: 'assessment_required',
          assessmentRoutePolicy: 'onsite_only',
          remoteAssessmentEnabled: true, // برضه الأدمن سايبه true — السياسة لازم تغلبه
          onsiteAssessmentEnabled: true,
        ),
      );
      expect(r.remote, isFalse, reason: 'onsite_only لازم تقفل مسار الصور حتى لو العلم شغّال');
      expect(r.onsite, isTrue);
    });

    test('customer_choice + المسارين مفعّلين: زي admin_triage بالظبط', () {
      final r = AssessmentRoutes.forService(
        _service(
          priceCertaintyMode: 'assessment_required',
          assessmentRoutePolicy: 'customer_choice',
          remoteAssessmentEnabled: true,
          onsiteAssessmentEnabled: true,
        ),
      );
      expect(r.remote, isTrue);
      expect(r.onsite, isTrue);
    });

    test('علم الصور مقفول من غير السياسة: مسار الصور مقفول برضه', () {
      final r = AssessmentRoutes.forService(
        _service(
          priceCertaintyMode: 'assessment_required',
          assessmentRoutePolicy: 'admin_triage',
          remoteAssessmentEnabled: false,
          onsiteAssessmentEnabled: true,
        ),
      );
      expect(r.remote, isFalse);
      expect(r.onsite, isTrue);
    });

    test('علم المعاينة مقفول من غير السياسة: مسار المعاينة مقفول برضه', () {
      final r = AssessmentRoutes.forService(
        _service(
          priceCertaintyMode: 'assessment_required',
          assessmentRoutePolicy: 'admin_triage',
          remoteAssessmentEnabled: true,
          onsiteAssessmentEnabled: false,
        ),
      );
      expect(r.remote, isTrue);
      expect(r.onsite, isFalse);
    });

    test('التقييم بالصور معناه غياب السعر — pricing_model formula مايفتحش مسار الصور', () {
      final r = AssessmentRoutes.forService(
        _service(
          priceCertaintyMode: 'assessment_required',
          assessmentRoutePolicy: 'admin_triage',
          remoteAssessmentEnabled: true,
          onsiteAssessmentEnabled: true,
          pricingModel: 'formula',
        ),
      );
      expect(r.remote, isFalse, reason: 'formula خدمتها سعرها معروف — التقييم بالصور مالوش معنى هنا');
      expect(r.onsite, isTrue);
    });

    test('مفيش أي مسار مفعّل: none() صح، ومفيش اختيار وهمي', () {
      final r = AssessmentRoutes.forService(
        _service(
          priceCertaintyMode: 'assessment_required',
          assessmentRoutePolicy: 'admin_triage',
          remoteAssessmentEnabled: false,
          onsiteAssessmentEnabled: false,
        ),
      );
      expect(r.none, isTrue);
      expect(r.hasChoice, isFalse);
    });
  });
}
