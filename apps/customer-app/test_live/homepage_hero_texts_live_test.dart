// اختبار حي — بيكلّم apps/api شغال فعلاً على localhost:3000 (نفس منهجية باقي test_live/).
// شغّله بـ:
//   flutter test test_live/homepage_hero_texts_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
//
// docs/08 §64.د — طلب المالك: «الكلام اللي تحت… عايز الأدمين ليه أكسس على الكلام ده». النصوص
// دي كانت مكتوبة ثابتة في الـDart، فأي تعديل صياغة كان يحتاج release. الاختبار ده بيثبّت إن
// إعداد `homepage.search_content` اتطبّق والـendpoint فعلاً بيرجّعه، وإن مفيش حقل بيرجع فاضي.
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/features/catalog/homepage_content_repository.dart';

void main() {
  test('محتوى الصفحة الرئيسية بيرجّع نصوص البحث من الإعدادات (مش ثابتة في الكود)', () async {
    final search = (await HomepageContentRepository().fetch()).search;

    // الأربعة لازم يوصلوا بقيمة حقيقية — الباك-إند بيرجّع الافتراضي لو الأدمن مسح الحقل، فمفيش
    // حالة إن الشاشة الرئيسية تفضل بلا عنوان أو بشريط بحث بلا نص إرشادي.
    expect(search.eyebrow.trim(), isNotEmpty);
    expect(search.title.trim(), isNotEmpty);
    expect(search.description.trim(), isNotEmpty);
    expect(search.placeholder.trim(), isNotEmpty);
  });
}
