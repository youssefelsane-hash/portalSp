import '../../core/auth_repository.dart';
import 'models.dart';

class ProgressionRepository {
  final AuthRepository auth;

  ProgressionRepository(this.auth);

  Future<ProgressionSummary> fetchSummary() async {
    final data = await auth.authedRequest('GET', '/technician/progression');
    return ProgressionSummary.fromJson(data!);
  }
}
