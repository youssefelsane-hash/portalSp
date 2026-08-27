// بناء رابط الـ embed الفعلي (مش oEmbed API — ده HTML مباشر يتحمّل جوّه WebView) من رابط
// الفيديو الأصلي اللي الفني حطه. كل منصة عندها صيغة embed مختلفة.
//
// بَقّة حقيقية اتلقطت (docs/08 §81): تيك توك بيطلّع short links (زي vm.tiktok.com/...) من زرار
// "مشاركة" — مفيهاش /video/<رقم> صريح، فـ_extractTrailingId تحت بيرجع null والفيديو يفشل يشتغل
// رغم إن الـthumbnail ظهر صح (الباك-إند بيتبع الـredirect فعليًا وقت جلب المعاينة، الكلاينت لأ).
// الحل: نستخدم embedVideoId (الـID اللي الباك-إند استخرجه فعليًا وقت oEmbed) لو موجود، ونرجع
// للـregex القديم كـfallback بس للينكات القديمة قبل الإصلاح.
String? buildPortfolioEmbedUrl(String platform, String originalUrl, {String? embedVideoId}) {
  switch (platform) {
    case 'youtube':
      final id = _extractYoutubeId(originalUrl);
      return id != null ? 'https://www.youtube.com/embed/$id' : null;
    case 'tiktok':
      final id = embedVideoId ?? _extractTrailingId(originalUrl, RegExp(r'/video/(\d+)'));
      return id != null ? 'https://www.tiktok.com/embed/v2/$id' : null;
    case 'instagram':
      final shortcode = _extractTrailingId(originalUrl, RegExp(r'/(?:p|reel)/([A-Za-z0-9_-]+)'));
      return shortcode != null ? 'https://www.instagram.com/p/$shortcode/embed' : null;
    case 'facebook':
      return 'https://www.facebook.com/plugins/video.php?href=${Uri.encodeComponent(originalUrl)}';
    default:
      return null;
  }
}

String? _extractYoutubeId(String url) {
  final uri = Uri.tryParse(url);
  if (uri == null) return null;
  if (uri.host.contains('youtu.be')) {
    return uri.pathSegments.isNotEmpty ? uri.pathSegments.first : null;
  }
  return uri.queryParameters['v'];
}

String? _extractTrailingId(String url, RegExp pattern) {
  final match = pattern.firstMatch(url);
  return match?.group(1);
}
