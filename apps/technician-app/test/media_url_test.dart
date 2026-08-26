import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/media_url.dart';

void main() {
  test('keeps absolute storage URLs unchanged', () {
    expect(resolveMediaUrl('https://storage.example/photo.jpg?signature=abc'),
        'https://storage.example/photo.jpg?signature=abc');
  });

  test('resolves legacy relative paths against the API origin', () {
    expect(resolveMediaUrl('/uploads/orders/photo.jpg'),
        'http://10.0.2.2:3000/uploads/orders/photo.jpg');
  });

  test('rebases stale absolute local-upload URLs to the active API origin', () {
    expect(
      resolveMediaUrl('http://192.168.0.67:3000/uploads/orders/photo.jpg?size=full'),
      'http://10.0.2.2:3000/uploads/orders/photo.jpg?size=full',
    );
  });
}
