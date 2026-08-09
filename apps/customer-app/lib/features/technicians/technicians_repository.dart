import '../../core/auth_repository.dart';
import 'models.dart';

class TechniciansRepository {
  final AuthRepository auth;

  TechniciansRepository(this.auth);

  Future<TechnicianPublicProfile> fetchPublicProfile(String technicianId) async {
    final data = await auth.authedRequest('GET', '/technicians/$technicianId/profile');
    return TechnicianPublicProfile.fromJson(data!);
  }
}
