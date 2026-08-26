import '../../core/api_client.dart';

// كارت "نصايح مفيدة" الواحد — طلب مالك صريح 2026-08-23: الأدمن يقدر يحط لينك صورة جاهزة (مش رفع
// ملف حقيقي) بدل التدرّج اللوني الثابت. imageUrl null = لسه ما اتحطش رابط، الـUI بيرجع للتدرّج
// الافتراضي (نفس apps/customer-web's TIP_FALLBACK_BACKGROUNDS بالحرف).
class HomepageTip {
  final String title;
  final String body;
  final String? imageUrl;

  HomepageTip({required this.title, required this.body, required this.imageUrl});

  factory HomepageTip.fromJson(Map<String, dynamic> json) => HomepageTip(
        title: json['title'] as String? ?? '',
        body: json['body'] as String? ?? '',
        imageUrl: json['image_url'] as String?,
      );
}

// مطابق لـ apps/api/src/modules/settings/homepage-content.controller.ts — رسالة الثقة/الضمان
// المعروضة في hero الشاشة الرئيسية، نص إداري قابل للتعديل من الأدمن (settings.homepage.trust_message)،
// مش ثابت في الكود. نفس نمط SupportContactRepository بالحرف (support_contact_repository.dart).
// tips (settings.homepage.tips) — كانت HOME_TIPS ثابتة في الكود، بقت مُدارة من الأدمن (docs/08 §48).
class HomepageContent {
  final String trustMessage;
  final List<String> heroImages;
  final List<HomepageTip> tips;

  // نصوص الـhero (docs/08 §64.د) — كانت ثابتة في الكود، بقت من الإعدادات. الباك-إند بيضمن إنها
  // مش فاضية أبدًا (بيرجّع الافتراضي لو الأدمن مسح الحقل)، والافتراضي هنا احتياط تاني لو النداء
  // نفسه فشل قبل ما يوصل.
  final String heroEyebrow;
  final String heroTitle;
  final String heroSubtitle;
  final String searchPlaceholder;

  HomepageContent({
    required this.trustMessage,
    required this.heroImages,
    required this.tips,
    required this.heroEyebrow,
    required this.heroTitle,
    required this.heroSubtitle,
    required this.searchPlaceholder,
  });

  static String _text(Map<String, dynamic> json, String key, String fallback) {
    final value = json[key] as String?;
    return (value == null || value.trim().isEmpty) ? fallback : value;
  }

  factory HomepageContent.fromJson(Map<String, dynamic> json) => HomepageContent(
        trustMessage: json['trust_message'] as String? ?? '',
        heroImages: (json['hero_images'] as List<dynamic>? ?? []).whereType<String>().toList(),
        tips: (json['tips'] as List<dynamic>? ?? [])
            .map((t) => HomepageTip.fromJson(t as Map<String, dynamic>))
            .toList(),
        heroEyebrow: _text(json, 'hero_eyebrow', 'أساعدك إزاي؟'),
        heroTitle: _text(json, 'hero_title', 'محتاج مساعدة في إيه؟'),
        heroSubtitle: _text(json, 'hero_subtitle', 'قول لينا مشكلتك بكلامك العادي، أو تصفّح الفئات تحت'),
        searchPlaceholder: _text(json, 'search_placeholder', 'وصّف مشكلتك... زي "المياه بتنزل من تحت الحوض"'),
      );
}

// GET /settings/homepage-content — @Public()، مفيش داعي لـaccessToken.
class HomepageContentRepository {
  Future<HomepageContent> fetch() async {
    final data = await apiRequest('GET', '/settings/homepage-content');
    return HomepageContent.fromJson(data!);
  }
}
