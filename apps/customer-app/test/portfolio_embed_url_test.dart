import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/features/technicians/portfolio_embed_url.dart';

// بَقّة حقيقية اتلقطت (docs/08 §81، بلاغ مالك بلينك تيك توك حقيقي فشل يشتغل): تيك توك بيطلّع
// short links (زي vm.tiktok.com/...) من زرار "مشاركة"، مفيهاش /video/<رقم> صريح، فـregex
// المحلي كان بيرجع null والفيديو يفشل يشتغل رغم إن الـthumbnail ظهر صح.
//
// ملحوظة: الاختبار ده اتكتب في بيئة من غير Flutter SDK — مش اتشغّل فعليًا (`flutter test`)،
// لازم يتأكد من سيشن عندها SDK قبل الاعتماد الكامل على الإصلاح (docs/08 §81).
void main() {
  group('buildPortfolioEmbedUrl — تيك توك (docs/08 §81)', () {
    test('embedVideoId موجود — بيتستخدم مباشرة بغض النظر عن شكل الرابط الخام (حتى short link)', () {
      final embedUrl = buildPortfolioEmbedUrl(
        'tiktok',
        'https://vm.tiktok.com/ZMabc123/',
        embedVideoId: '7123456789012345678',
      );
      expect(embedUrl, 'https://www.tiktok.com/embed/v2/7123456789012345678');
    });

    test('embedVideoId مش موجود، رابط طويل عادي — رجوع للـregex القديم (سلوك موجود، صفر كسر)', () {
      final embedUrl = buildPortfolioEmbedUrl('tiktok', 'https://www.tiktok.com/@user/video/1234567890');
      expect(embedUrl, 'https://www.tiktok.com/embed/v2/1234567890');
    });

    test('embedVideoId مش موجود، short link — بيرجع null (لينكات قديمة قبل الإصلاح، فجوة معروفة)', () {
      final embedUrl = buildPortfolioEmbedUrl('tiktok', 'https://vm.tiktok.com/ZMabc123/');
      expect(embedUrl, isNull);
    });

    test('embedVideoId موجود لكن المنصة يوتيوب — متجاهل عمداً (النطاق تيك توك بس)', () {
      final embedUrl = buildPortfolioEmbedUrl(
        'youtube',
        'https://youtu.be/dQw4w9WgXcQ',
        embedVideoId: '7123456789012345678',
      );
      expect(embedUrl, 'https://www.youtube.com/embed/dQw4w9WgXcQ');
    });
  });
}
