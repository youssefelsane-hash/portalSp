// اختبار حي — بيكلّم apps/api شغال فعلاً على localhost:3000 (نفس منهجية باقي test_live/).
// شغّله بـ:
//   flutter test test_live/homepage_hero_texts_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
//
// docs/08 §64.د — طلب المالك: «الكلام اللي تحت… عايز الأدمين ليه أكسس على الكلام ده». النصوص
// دي كانت مكتوبة ثابتة في الـDart، فأي تعديل صياغة كان يحتاج release. الاختبار ده بيثبّت إن
// الـmigration اتطبّقت والـendpoint فعلاً بيرجّعها، وإن الافتراضي مش فاضي أبدًا.
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/features/catalog/homepage_content_repository.dart';

void main() {
  test('محتوى الصفحة الرئيسية بيرجّع نصوص الـhero من الإعدادات (مش ثابتة في الكود)', () async {
    final content = await HomepageContentRepository().fetch();

    // الأربعة لازم يوصلوا بقيمة حقيقية — الباك-إند بيرجّع الافتراضي لو الأدمن مسح الحقل، فمفيش
    // حالة إن الشاشة الرئيسية تفضل بلا عنوان أو بشريط بحث بلا نص إرشادي.
    expect(content.heroEyebrow.trim(), isNotEmpty);
    expect(content.heroTitle.trim(), isNotEmpty);
    expect(content.heroSubtitle.trim(), isNotEmpty);
    expect(content.searchPlaceholder.trim(), isNotEmpty);
  });
}
