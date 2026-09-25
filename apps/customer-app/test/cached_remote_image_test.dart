import 'package:customer_app/design/cached_remote_image.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('keeps absolute CDN image URLs unchanged', () {
    expect(
      resolveCachedRemoteImageUrl('https://cdn.example/category.webp'),
      'https://cdn.example/category.webp',
    );
  });

  test('resolves relative admin-upload URLs against the active API origin', () {
    expect(
      resolveCachedRemoteImageUrl('/uploads/catalog/category.webp'),
      'http://10.0.2.2:3000/uploads/catalog/category.webp',
    );
  });

  test('uses one stable cache key across refreshed R2 signatures', () {
    const first =
        'https://r2.example.com/bucket/service-categories/1/cover/photo.webp'
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260923T100000Z'
        '&X-Amz-Signature=first';
    const refreshed =
        'https://r2.example.com/bucket/service-categories/1/cover/photo.webp'
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260924T100000Z'
        '&X-Amz-Signature=second';

    expect(remoteImageCacheKey(first), remoteImageCacheKey(refreshed));
    expect(
      remoteImageCacheKey(first),
      'https://r2.example.com/bucket/service-categories/1/cover/photo.webp',
    );
  });

  test('keeps non-signing query parameters that can select another image', () {
    const url = 'https://cdn.example/photo.webp?width=320&variant=dark';
    expect(remoteImageCacheKey(url), url);
  });
}
