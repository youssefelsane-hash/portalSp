import '../../core/api_client.dart';

// مطابق لـ apps/api/src/modules/branding/dto/branding-response.dto.ts's BrandingAssetResponseDto —
// بس primary_logo وsplash، بقية الأصول (logo_mark/...) مش مستهلكة في التطبيق ده لسه.
class BrandingLogo {
  final String url;
  final bool isDefault;

  BrandingLogo({required this.url, required this.isDefault});

  factory BrandingLogo.fromJson(Map<String, dynamic> json) =>
      BrandingLogo(url: json['url'] as String? ?? '', isDefault: json['is_default'] as bool? ?? true);
}

// GET /branding — @Public()، بيرجّع fallback (data: URI افتراضي أو تدرّج محلي) دايمًا لو مفيش
// حاجة مرفوعة من الأدمن. الكولر (HomeScreen) بيتجاهل النتيجة لو isDefault=true ويستخدم الـfallback
// المحلي بدلها، ويعرض الصورة الحقيقية بس لو الأدمن رفع واحدة (isDefault=false، دايمًا PNG/JPEG/WEBP
// حقيقي — validateBrandingFile بيرفض أي حاجة تانية).
class BrandingRepository {
  /// **كاش لعمر العملية**: `/branding` كان بيتنادى من كل شاشة بتعرض اللوجو، وفي كل مرة العين
  /// بتشوف البديل المحلي الأول وبعدين يتبدّل باللوجو الحقيقي — تبديل مرئي مالوش لازمة، وهو
  /// جزء من بلاغ «بيكسلات مش مظبوطة وقت التحميل» (2026-09-10). البراند بيتغيّر من الأدمن
  /// نادرًا جدًا، فنداء واحد لكل تشغيل أكتر من كافي، وإعادة فتح التطبيق بتجيب الجديد.
  static Future<Map<String, dynamic>?>? _inFlight;

  static Future<Map<String, dynamic>?> _branding() =>
      _inFlight ??= apiRequest('GET', '/branding').catchError((Object err) {
        _inFlight = null; // فشل مؤقت مايتكاشش — المحاولة الجاية تحاول تاني
        throw err;
      });

  /// للاختبارات فقط — بتصفّر الكاش عشان كل حالة تبدأ من نقطة معروفة.
  static void resetCacheForTests() => _inFlight = null;

  // بلاغ مالك صريح 2026-08-23: "الصور مش بتظهر على الأبليكيشن" — كان السبب إن التطبيق أصلاً
  // مكانش بيستهلك /branding خالص، مش بَقّة في التخزين نفسه.
  Future<BrandingLogo?> fetchPrimaryLogo() async {
    final data = await _branding();
    final logoJson = data?['primary_logo'] as Map<String, dynamic>?;
    if (logoJson == null) return null;
    return BrandingLogo.fromJson(logoJson);
  }

  // بلاغ مالك صريح تاني نفس اليوم: رفع صورة لـ"شاشة البداية (Splash)" في الأدمن متوقّعًا إنها
  // تبقى خلفية الشاشة الرئيسية وراء صندوق البحث — نفس فجوة الاستهلاك بالظبط (asset_type='splash'
  // كان موجود في الـAPI من زمان، بس مفيش أي حد بيستهلكه). راجع packages/shared-types/src/branding.ts
  // للاسم الموضّح في الأدمن.
  Future<BrandingLogo?> fetchHeroBackground() async {
    final data = await _branding();
    final json = data?['splash'] as Map<String, dynamic>?;
    if (json == null) return null;
    return BrandingLogo.fromJson(json);
  }

  /// بانر الشاشة الرئيسية (ADR-0095، docs/08 §150 بند ٣) — **مستقل عن خلفية الـhero فوق**:
  /// ده صورة مستطيلة جوّه محتوى الصفحة، مش خلفية وراء نص.
  ///
  /// `isDefault = true` معناها الأدمن مارفعش صورة لسه ⇒ **الخانة كلها بتختفي**. مفيش عنصر
  /// نائب بيتعرض للعميل، لأن مفيش محتوى إعلاني عام صح نعرضه بدل صورة المالك.
  Future<BrandingLogo?> fetchHomeBanner() async {
    final data = await _branding();
    final json = data?['home_banner'] as Map<String, dynamic>?;
    if (json == null) return null;
    return BrandingLogo.fromJson(json);
  }
}
