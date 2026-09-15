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
}
