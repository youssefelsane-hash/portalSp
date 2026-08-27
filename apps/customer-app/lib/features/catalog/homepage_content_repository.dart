import '../../core/api_client.dart';

// كارت "نصايح مفيدة" الواحد — طلب مالك صريح 2026-08-23: الأدمن يقدر يحط لينك صورة جاهزة (مش رفع
// ملف حقيقي) بدل التدرّج اللوني الثابت. imageUrl null = لسه ما اتحطش رابط، الـUI بيرجع للتدرّج
// الافتراضي (نفس apps/customer-web's TIP_FALLBACK_BACKGROUNDS بالحرف).
class HomepageTip {
  final String title;
  final String body;
  final String? imageUrl;

  HomepageTip({
    required this.title,
    required this.body,
    required this.imageUrl,
  });

  factory HomepageTip.fromJson(Map<String, dynamic> json) => HomepageTip(
    title: json['title'] as String? ?? '',
    body: json['body'] as String? ?? '',
    imageUrl: json['image_url'] as String?,
  );
}

class HomepageSearchContent {
  final String eyebrow;
  final String title;
  final String description;
  final String placeholder;

  const HomepageSearchContent({
    required this.eyebrow,
    required this.title,
    required this.description,
    required this.placeholder,
  });

  // بلاغ المالك (2026-08-27): «المياه بتنزل من تحت الحوض — ده مش منطقي… الناس بتكتب حوض،
  // غسالة، حنفية». والبحث فعلاً بيشتغل بمطابقة كلمات/مرادفات (`searchServices`)، مش فهم جُمل —
  // فالمثال القديم كان بيوعد بقدرة مش موجودة وبيخلي العميل يكتب جملة طويلة ما تطابقش حاجة.
  // النص الجديد بيوجّهه لاسم الحاجة/الجهاز، وده اللي المحرك بيلاقيه فعلاً.
  static const defaults = HomepageSearchContent(
    eyebrow: 'أساعدك إزاي؟',
    title: 'محتاج مساعدة في إيه؟',
    description: 'اكتب اسم الحاجة اللي فيها المشكلة — زي «حنفية»، «غسالة»، «كهربا»',
    placeholder: 'اوصف لنا مشكلتك أو الشيء اللي فيه المشكلة',
  );

  factory HomepageSearchContent.fromJson(Map<String, dynamic>? json) =>
      HomepageSearchContent(
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

  HomepageContent({
    required this.trustMessage,
    required this.heroImages,
    required this.search,
    required this.tips,
  });

  factory HomepageContent.fromJson(Map<String, dynamic> json) {
    return HomepageContent(
      trustMessage: json['trust_message'] as String? ?? '',
      heroImages: (json['hero_images'] as List<dynamic>? ?? [])
          .whereType<String>()
          .toList(),
      search: HomepageSearchContent.fromJson(json['search'] as Map<String, dynamic>?),
      tips: (json['tips'] as List<dynamic>? ?? [])
          .map((t) => HomepageTip.fromJson(t as Map<String, dynamic>))
          .toList(),
    );
  }
}

// GET /settings/homepage-content — @Public()، مفيش داعي لـaccessToken.
class HomepageContentRepository {
  Future<HomepageContent> fetch() async {
    final data = await apiRequest('GET', '/settings/homepage-content');
    return HomepageContent.fromJson(data!);
  }
}
