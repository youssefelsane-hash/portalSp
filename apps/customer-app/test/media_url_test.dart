import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/media_url.dart';

void main() {
  test('keeps absolute storage URLs unchanged', () {
    expect(resolveMediaUrl('https://storage.example/photo.jpg?signature=abc'),
        'https://storage.example/photo.jpg?signature=abc');
  });

  test('resolves legacy relative paths against the API origin', () {
    expect(resolveMediaUrl('/uploads/orders/photo.jpg'),
        'http://10.0.2.2:3000/uploads/orders/photo.jpg');
  });
}
