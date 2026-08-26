import '../../core/api_client.dart';

// كارت "نصايح مفيدة" الواحد — طلب مالك صريح 2026-08-23: الأدمن يقدر يحط لينك صورة جاهزة (مش رفع
// ملف حقيقي) بدل التدرّج اللوني الثابت. imageUrl null = لسه ما اتحطش رابط، الـUI بيرجع للتدرّج
// الافتراضي (نفس apps/customer-web's TIP_FALLBACK_BACKGROUNDS بالحرف).
class HomepageTip {
  final String title;
  final String body;
  final String? imageUrl;

  HomepageTip({required this.title, required this.body, required this.imageUrl});

  factory HomepageTip.fromJson(Map<String, dynamic> json) => HomepageTip(title: json['title'] as String? ?? '', body: json['body'] as String? ?? '', imageUrl: json['image_url'] as String?);
}

class HomepageSearchContent {
  final String eyebrow;
  final String title;
  final String description;
  final String placeholder;

  const HomepageSearchContent({required this.eyebrow, required this.title, required this.description, required this.placeholder});

  static const defaults = HomepageSearchContent(
    eyebrow: 'أساعدك إزاي؟',
    title: 'محتاج مساعدة في إيه؟',
    description: 'قول لينا مشكلتك بكلامك العادي، أو تصفّح الفئات تحت',
    placeholder: 'وصّف مشكلتك... زي "المياه بتنزل من تحت الحوض"',
  );

  factory HomepageSearchContent.fromJson(Map<String, dynamic>? json) => HomepageSearchContent(
    eyebrow: json?['eyebrow'] as String? ?? defaults.eyebrow,
    title: json?['title'] as String? ?? defaults.title,
    description: json?['description'] as String? ?? defaults.description,
    placeholder: json?['placeholder'] as String? ?? defaults.placeholder,
  );
}

// مطابق لـ apps/api/src/modules/settings/homepage-content.controller.ts — رسالة الثقة/الضمان
// المعروضة في hero الشاشة الرئيسية، نص إداري قابل للتعديل من الأدمن (settings.homepage.trust_message)،
// مش ثابت في الكود. نفس نمط SupportContactRepository بالحرف (support_contact_repository.dart).
// tips (settings.homepage.tips) — كانت HOME_TIPS ثابتة في الكود، بقت مُدارة من الأدمن (docs/08 §48).
class HomepageContent {
  final String trustMessage;
  final List<String> heroImages;
  final HomepageSearchContent search;
  final List<HomepageTip> tips;

  HomepageContent({required this.trustMessage, required this.heroImages, required this.search, required this.tips});

  factory HomepageContent.fromJson(Map<String, dynamic> json) => HomepageContent(
    trustMessage: json['trust_message'] as String? ?? '',
    heroImages: (json['hero_images'] as List<dynamic>? ?? []).whereType<String>().toList(),
    search: HomepageSearchContent.fromJson(json['search'] as Map<String, dynamic>?),
    tips: (json['tips'] as List<dynamic>? ?? []).map((t) => HomepageTip.fromJson(t as Map<String, dynamic>)).toList(),
  );
}

// GET /settings/homepage-content — @Public()، مفيش داعي لـaccessToken.
class HomepageContentRepository {
  Future<HomepageContent> fetch() async {
    final data = await apiRequest('GET', '/settings/homepage-content');
    return HomepageContent.fromJson(data!);
  }
}
