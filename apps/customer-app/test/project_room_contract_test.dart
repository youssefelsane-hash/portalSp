import 'package:customer_app/core/auth_repository.dart';
import 'package:customer_app/features/projects/project_room_screen.dart';
import 'package:flutter_test/flutter_test.dart';

class _ProjectRoomAuth extends AuthRepository {
  String? method;
  String? path;
  Map<String, dynamic>? body;

  @override
  Future<Map<String, dynamic>?> authedRequest(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? extraHeaders,
  }) async {
    this.method = method;
    this.path = path;
    this.body = body;
    return <String, dynamic>{};
  }
}

void main() {
  test('project room keeps general comments returned by the API', () {
    final room = ProjectRoom.fromJson({
      'project': {'id': 'project-1'},
      'comments': [
        {'id': 'comment-1', 'body': 'تحديث ظاهر للعميل'},
      ],
    });

    expect(room.comments, hasLength(1));
    expect(room.comments.first['body'], 'تحديث ظاهر للعميل');
  });

  test('customer project comment uses the owned project route', () async {
    final auth = _ProjectRoomAuth();
    await ProjectsRepository(auth).addComment('project-1', 'متى تبدأ المرحلة؟');

    expect(auth.method, 'POST');
    expect(auth.path, '/me/projects/project-1/comments');
    expect(auth.body, {'body': 'متى تبدأ المرحلة؟'});
  });
}
