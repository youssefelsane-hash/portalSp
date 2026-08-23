import '../../core/api_client.dart';

// مطابق لـ apps/api/src/modules/settings/homepage-content.controller.ts — رسالة الثقة/الضمان
// المعروضة في hero الشاشة الرئيسية، نص إداري قابل للتعديل من الأدمن (settings.homepage.trust_message)،
// مش ثابت في الكود. نفس نمط SupportContactRepository بالحرف (support_contact_repository.dart).
class HomepageContent {
  final String trustMessage;

  HomepageContent({required this.trustMessage});

  factory HomepageContent.fromJson(Map<String, dynamic> json) =>
      HomepageContent(trustMessage: json['trust_message'] as String? ?? '');
}

// GET /settings/homepage-content — @Public()، مفيش داعي لـaccessToken.
class HomepageContentRepository {
  Future<HomepageContent> fetch() async {
    final data = await apiRequest('GET', '/settings/homepage-content');
    return HomepageContent.fromJson(data!);
  }
}
