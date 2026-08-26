import 'package:customer_app/features/catalog/homepage_content_repository.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('homepage search copy uses the admin-provided values', () {
    final content = HomepageContent.fromJson({
      'search': {'eyebrow': 'ابدأ من هنا', 'title': 'احكي لنا المشكلة', 'description': 'اكتبها بطريقتك', 'placeholder': 'مثال: التكييف مش بيبرد'},
    });

    expect(content.search.eyebrow, 'ابدأ من هنا');
    expect(content.search.title, 'احكي لنا المشكلة');
    expect(content.search.description, 'اكتبها بطريقتك');
    expect(content.search.placeholder, 'مثال: التكييف مش بيبرد');
  });

  test('homepage search copy remains backward compatible when absent', () {
    final content = HomepageContent.fromJson({});

    expect(content.search.eyebrow, HomepageSearchContent.defaults.eyebrow);
    expect(content.search.title, HomepageSearchContent.defaults.title);
    expect(content.search.description, HomepageSearchContent.defaults.description);
    expect(content.search.placeholder, HomepageSearchContent.defaults.placeholder);
  });
}
