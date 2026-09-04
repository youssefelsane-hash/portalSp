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
  _bindingTests();

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

    test(
      'remote_only: بالصور بس، معاينة الموقع مقفولة — نفس الباك-إند بعد إصلاح §124-B',
      () {
        final r = AssessmentRoutes.forService(
          _service(
            priceCertaintyMode: 'assessment_required',
            assessmentRoutePolicy: 'remote_only',
            remoteAssessmentEnabled: true,
            onsiteAssessmentEnabled:
                true, // الأدمن سايبه true بالغلط — السياسة لازم تغلبه
          ),
        );
        expect(r.remote, isTrue);
        expect(
          r.onsite,
          isFalse,
          reason: 'remote_only لازم تقفل مسار المعاينة حتى لو العلم شغّال',
        );
      },
    );

    test('onsite_only: معاينة بس، الصور مقفولة', () {
      final r = AssessmentRoutes.forService(
        _service(
          priceCertaintyMode: 'assessment_required',
          assessmentRoutePolicy: 'onsite_only',
          remoteAssessmentEnabled:
              true, // برضه الأدمن سايبه true — السياسة لازم تغلبه
          onsiteAssessmentEnabled: true,
        ),
      );
      expect(
        r.remote,
        isFalse,
        reason: 'onsite_only لازم تقفل مسار الصور حتى لو العلم شغّال',
      );
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

    test(
      'التقييم بالصور معناه غياب السعر — pricing_model formula مايفتحش مسار الصور',
      () {
        final r = AssessmentRoutes.forService(
          _service(
            priceCertaintyMode: 'assessment_required',
            assessmentRoutePolicy: 'admin_triage',
            remoteAssessmentEnabled: true,
            onsiteAssessmentEnabled: true,
            pricingModel: 'formula',
          ),
        );
        expect(
          r.remote,
          isFalse,
          reason: 'formula خدمتها سعرها معروف — التقييم بالصور مالوش معنى هنا',
        );
        expect(r.onsite, isTrue);
      },
    );

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

/// ربط الطلب بمنفّذ (docs/08 §131) — البَقّة اللي المالك لقطها بلقطة شاشة: العميل اختار
/// «اختاروا لي الأنسب» فاتعملت تذكرة فني، بعدين اختار «الإدارة تحدد السعر من الصور»، فاتقفل
/// عند التأكيد بـ«معاينة الفني لا تُجمع مع تقييم الصور» بلا أي طريقة يرجع منها.
void _bindingTests() {
  group(
    'BookingProviderBinding.resolve() — التقييم بالصور بيصفّر ربط المنفّذ',
    () {
      test('مع التقييم بالصور: كل الحقول null مهما كان اللي اتبعت', () {
        final b = BookingProviderBinding.resolve(
          remoteQuote: true,
          technicianId: 'tech-1',
          companyId: 'company-1',
          scheduleSlotId: 'slot-1',
          matchPreviewId: 'preview-1',
        );
        expect(b.isEmpty, isTrue);
        expect(b.technicianId, isNull);
        expect(b.companyId, isNull);
        expect(b.scheduleSlotId, isNull);
        expect(
          b.matchPreviewId,
          isNull,
          reason: 'التذكرة هي اللي كانت بترجّع 400 عند التأكيد',
        );
      });

      test('بلا تقييم بالصور: كل الحقول بتعدّي زي ما هي', () {
        final b = BookingProviderBinding.resolve(
          remoteQuote: false,
          technicianId: 'tech-1',
          companyId: 'company-1',
          scheduleSlotId: 'slot-1',
          matchPreviewId: 'preview-1',
        );
        expect(b.isEmpty, isFalse);
        expect(b.technicianId, 'tech-1');
        expect(b.companyId, 'company-1');
        expect(b.scheduleSlotId, 'slot-1');
        expect(b.matchPreviewId, 'preview-1');
      });

      test(
        'بلا تقييم بالصور وبلا أي منفّذ مختار: فاضية برضه (حجز تلقائي عادي)',
        () {
          expect(
            BookingProviderBinding.resolve(remoteQuote: false).isEmpty,
            isTrue,
          );
        },
      );
    },
  );

  /// **بَقّة حقيقية اتلقطت بفحص حي على الـAPI (docs/08 §131)**: أي خدمة عليها رسم تقييم بالصور
  /// كانت مستحيلة الحجز من التطبيق، لأن الشاشة كانت بتبعت `paymentMethod: null` لمسار الصور
  /// بلا استثناء. القاعدة هنا ثنائية في الاتجاهين — الباك-إند بيرفض غياب الطريقة مع رسم،
  /// وبيرفض وجودها بلا رسم.
  group('طريقة الدفع المتبعتة مع الطلب (docs/08 §131)', () {
    test('مسار الصور برسم: الطريقة المختارة بتتبعت زي ما هي', () {
      expect(
        bookingPaymentMethod(
          remoteQuote: true,
          remoteAssessmentFeeCents: 5000,
          selected: 'card',
        ),
        'card',
      );
    });

    test(
      'مسار الصور بلا رسم: مفيش طريقة دفع خالص حتى لو المستخدم مختار واحدة',
      () {
        expect(
          bookingPaymentMethod(
            remoteQuote: true,
            remoteAssessmentFeeCents: 0,
            selected: 'card',
          ),
          isNull,
        );
      },
    );

    test('مسار عادي: التقسيط بيتحوّل لـnull (بيتظبط بعد إنشاء الطلب)', () {
      expect(
        bookingPaymentMethod(
          remoteQuote: false,
          remoteAssessmentFeeCents: 0,
          selected: 'installment',
        ),
        isNull,
      );
      expect(
        bookingPaymentMethod(
          remoteQuote: false,
          remoteAssessmentFeeCents: 0,
          selected: 'instapay',
        ),
        'instapay',
      );
    });

    test(
      'الكاش مش من طرق رسم التقييم — الباك-إند بيقبل بطاقة/InstaPay/فوري بس',
      () {
        expect(kElectronicPaymentMethods.contains('card'), isTrue);
        expect(kElectronicPaymentMethods.contains('instapay'), isTrue);
        expect(kElectronicPaymentMethods.contains('fawry_reference'), isTrue);
        expect(kElectronicPaymentMethods.contains('cash'), isFalse);
        expect(kElectronicPaymentMethods.contains('installment'), isFalse);
      },
    );
  });
}
