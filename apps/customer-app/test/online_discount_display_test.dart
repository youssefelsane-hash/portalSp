import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/features/orders/create_order_screen.dart';

/// بلاغ مالك 2026-09-21 (بلقطة شاشة): كارت «تحويل InstaPay» كان بيعرض «150 ← 120» في طلب
/// تقييم بالصور، جنب ملخّص في نفس الشاشة بيقول «رسم التقييم (يتدفع دلوقتي) 50 ج.م».
void main() {
  group('الرقم المعروض في خصم الدفع الإلكتروني', () {
    test('تقييم بالصور: الشطب على رسم التقييم (50) مش على سعر الشغل (150)', () {
      final r = resolveOnlineDiscountDisplay(
        discountCents: 3000,              // حافز 30 ج.م
        remoteAssessmentFeeDueCents: 5000, // رسم التقييم 50 ج.م
        previewTotalCents: 15000,          // تقدير المعاينة الميدانية 150 ج.م
      );
      expect(r.applies, isTrue);
      expect(r.baseCents, 5000, reason: 'كان بياخد 15000 — ده كان البلاغ بالظبط');
      expect(r.baseCents! - 3000, 2000, reason: 'المعروض لازم يبقى «50 ← 20»');
    });

    test('معاينة ميدانية: الشطب على سعر الشغل زي ما كان', () {
      final r = resolveOnlineDiscountDisplay(
        discountCents: 3000,
        remoteAssessmentFeeDueCents: 0, // مفيش رسم تقييم مستحق
        previewTotalCents: 15000,
      );
      expect(r.applies, isTrue);
      expect(r.baseCents, 15000);
      expect(r.baseCents! - 3000, 12000, reason: '«150 ← 120» لسه صح هنا');
    });

    test('حافز مساوي أو أكبر من المستحق: الخصم مابيتعرضش أصلاً', () {
      // نفس قاعدة eligibleInstaPayDiscountCents() في الباك-إند.
      expect(
        resolveOnlineDiscountDisplay(
          discountCents: 3000, remoteAssessmentFeeDueCents: 3000, previewTotalCents: 15000,
        ).applies,
        isFalse,
        reason: 'مساوي — الباك-إند مش هيطبّقه، فالواجهة ماتوعدش بيه',
      );
      expect(
        resolveOnlineDiscountDisplay(
          discountCents: 3000, remoteAssessmentFeeDueCents: 2000, previewTotalCents: 15000,
        ).applies,
        isFalse,
        reason: 'أكبر — من غير الحارس كان هيعرض «20 ← 0» والعميل يتحاسب 20',
      );
    });

    test('مفيش حافز أصلاً = مفيش سطر خصم', () {
      expect(
        resolveOnlineDiscountDisplay(
          discountCents: 0, remoteAssessmentFeeDueCents: 5000, previewTotalCents: 15000,
        ).applies,
        isFalse,
      );
    });

    test('المعاينة لسه بتحمّل: بيعرض الشارة بلا أرقام بدل ما يخمّن', () {
      final r = resolveOnlineDiscountDisplay(
        discountCents: 3000, remoteAssessmentFeeDueCents: 0, previewTotalCents: null,
      );
      expect(r.baseCents, isNull);
      expect(r.applies, isTrue, reason: 'الويدجت بيخفي الأرقام لوحده لما الأساس null');
    });
  });
}
