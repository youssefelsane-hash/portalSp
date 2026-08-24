import 'package:customer_app/core/auth_repository.dart';
import 'package:customer_app/features/projects/create_project_screen.dart';
import 'package:flutter_test/flutter_test.dart';

class _DelayedProjectAuth extends AuthRepository {
  Map<String, dynamic>? capturedBody;
  bool responseCompleted = false;

  @override
  Future<Map<String, dynamic>?> authedRequest(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? extraHeaders,
  }) async {
    expect(method, 'POST');
    expect(path, '/me/projects');
    capturedBody = body;
    await Future<void>.delayed(Duration.zero);
    responseCompleted = true;
    return {'id': 'project-1', 'name_ar': body?['name_ar']};
  }
}

void main() {
  test('إنشاء المشروع ينتظر رد API ويرسل الميزانية بالقرش', () async {
    final auth = _DelayedProjectAuth();
    final result = await ProjectsRepo(auth).create(
      projectType: 'finishing',
      nameAr: 'تشطيب البيت',
      description: 'وصف كامل من العميل',
      addressId: 'address-1',
      budget: 50000,
    );

    expect(auth.responseCompleted, isTrue);
    expect(result, {'id': 'project-1', 'name_ar': 'تشطيب البيت'});
    expect(
      auth.capturedBody,
      containsPair('description_ar', 'وصف كامل من العميل'),
    );
    expect(auth.capturedBody, containsPair('budget_estimate_cents', 5000000));
  });
}
