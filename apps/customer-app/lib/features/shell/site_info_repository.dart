import '../../core/api_client.dart';

/// بيانات الجهة المشغّلة الحيّة — `GET /legal-entity` (docs/08 §100).
///
/// **نفس العقد بالحرف** اللي `apps/customer-web/src/lib/legal-content.ts` بيقراه. المالك
/// بيدخّل القيم دي من شاشة الأدمن، فأي تعديل لازم يظهر على التطبيق والموقع مع بعض بلا إعادة
/// نشر. أي قيمة لسه فاضية بترجع `null` والواجهة بتخفي السطر بالكامل — «لو أي بيانات لسه فاضية،
/// ما تظهرش كسطر فاضي» (نص المالك).
class LegalEntityInfo {
  final String platformNameAr;
  final String platformNameEn;
  final String companyNameAr;
  final String companyNameEn;
  final String? legalAddress;
  final String? supportEmail;
  final String? supportPhone;
  final String? commercialRegister;
  final String? taxId;

  const LegalEntityInfo({
    required this.platformNameAr,
    required this.platformNameEn,
    required this.companyNameAr,
    required this.companyNameEn,
    this.legalAddress,
    this.supportEmail,
    this.supportPhone,
    this.commercialRegister,
    this.taxId,
  });

  /// الأسماء المعتمدة بس، **بلا أي بيانات تواصل مخترعة** — نفس `LEGAL_ENTITY_FALLBACK` في الويب.
  /// الفوتر لازم يفضل يعرض حقوق الملكية حتى لو الشبكة واقعة؛ ده سطر قانوني مش تفصيلة تجميلية.
  static const fallback = LegalEntityInfo(
    platformNameAr: 'أسطى',
    platformNameEn: 'OSTA',
    companyNameAr: 'الصانع جروب',
    companyNameEn: 'ELSANE Group',
  );

  factory LegalEntityInfo.fromJson(Map<String, dynamic> json) {
    String? clean(String key) {
      final value = json[key] as String?;
      if (value == null || value.trim().isEmpty) return null;
      return value.trim();
    }

    return LegalEntityInfo(
      platformNameAr: clean('platform_name_ar') ?? fallback.platformNameAr,
      platformNameEn: clean('platform_name_en') ?? fallback.platformNameEn,
      companyNameAr: clean('company_name_ar') ?? fallback.companyNameAr,
      companyNameEn: clean('company_name_en') ?? fallback.companyNameEn,
      legalAddress: clean('legal_address'),
      supportEmail: clean('support_email'),
      supportPhone: clean('support_phone'),
      commercialRegister: clean('commercial_register'),
      taxId: clean('tax_id'),
    );
  }
}

/// رابط سوشيال واحد. العقد بيرجّع **المضبوط بس** — الشبكة اللي الأدمن ما ملاش رابطها مش بتيجي
/// أصلاً، فمفيش أي قرار على الواجهة تاخده ومفيش زرار بيودّي لحتة فاضية.
class SocialLink {
  final String network;
  final String url;

  const SocialLink({required this.network, required this.url});

  factory SocialLink.fromJson(Map<String, dynamic> json) => SocialLink(
    network: json['network'] as String? ?? '',
    url: json['url'] as String? ?? '',
  );
}

const socialLabelsAr = <String, String>{
  'facebook': 'فيسبوك',
  'instagram': 'إنستجرام',
  'tiktok': 'تيك توك',
  'linkedin': 'لينكدإن',
  'youtube': 'يوتيوب',
};

/// بيانات الفوتر المشتركة. **مبتفشلش أبدًا**: الفوتر بيتعرض في آخر الشاشة الرئيسية، وفشل
/// الشبكة هنا ما ينفعش يكسر الشاشة كلها — بيرجع القيم المعتمدة وقايمة سوشيال فاضية.
class SiteInfoRepository {
  Future<LegalEntityInfo> legalEntity() async {
    try {
      final data = await apiRequest('GET', '/legal-entity');
      if (data == null) return LegalEntityInfo.fallback;
      return LegalEntityInfo.fromJson(data);
    } catch (_) {
      return LegalEntityInfo.fallback;
    }
  }

  Future<List<SocialLink>> socialLinks() async {
    try {
      final data = await apiRequest('GET', '/social-links');
      final links = data?['links'];
      if (links is! List) return const [];
      return links
          .whereType<Map<String, dynamic>>()
          .map(SocialLink.fromJson)
          .where((link) => link.network.isNotEmpty && link.url.isNotEmpty)
          .toList();
    } catch (_) {
      return const [];
    }
  }
}
