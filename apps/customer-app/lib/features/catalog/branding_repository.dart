import '../../core/api_client.dart';

// مطابق لـ apps/api/src/modules/branding/dto/branding-response.dto.ts's BrandingAssetResponseDto —
// بس primary_logo، بقية الأصول (logo_mark/splash/...) مش مستهلكة في التطبيق ده لسه.
class BrandingLogo {
  final String url;
  final bool isDefault;

  BrandingLogo({required this.url, required this.isDefault});

  factory BrandingLogo.fromJson(Map<String, dynamic> json) =>
      BrandingLogo(url: json['url'] as String? ?? '', isDefault: json['is_default'] as bool? ?? true);
}

// GET /branding — @Public()، بيرجّع fallback SVG (data: URI) دايمًا لو مفيش لوجو مرفوع من الأدمن.
// data: URI مش قابل للعرض بـImage.network (مفيش flutter_svg في المشروع) — الكولر (HomeScreen)
// بيتجاهل النتيجة لو isDefault=true ويسيب الاسم النصي "صُنّاع" زي ما هو، ويعرض الصورة الحقيقية
// بس لو الأدمن رفع لوجو فعلي (isDefault=false، دايمًا PNG/JPEG/WEBP حقيقي — validateBrandingFile
// بيرفض أي حاجة تانية). بلاغ مالك صريح 2026-08-23: "الصور مش بتظهر على الأبليكيشن" — كان السبب
// إن التطبيق أصلاً مكانش بيستهلك /branding خالص، مش بَقّة في التخزين نفسه.
class BrandingRepository {
  Future<BrandingLogo?> fetchPrimaryLogo() async {
    final data = await apiRequest('GET', '/branding');
    final logoJson = data?['primary_logo'] as Map<String, dynamic>?;
    if (logoJson == null) return null;
    return BrandingLogo.fromJson(logoJson);
  }
}
