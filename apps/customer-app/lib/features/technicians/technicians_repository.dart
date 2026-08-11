import '../../core/auth_repository.dart';
import 'models.dart';

class TechniciansRepository {
  final AuthRepository auth;

  TechniciansRepository(this.auth);

  Future<TechnicianPublicProfile> fetchPublicProfile(String technicianId) async {
    final data = await auth.authedRequest('GET', '/technicians/$technicianId/profile');
    return TechnicianPublicProfile.fromJson(data!);
  }

  // "اعتماد" (docs/06 §1.5) — الشركات/الفرق النشطة اللي العميل يقدر يحجزها كاملة.
  Future<List<TechnicianCompanySummary>> listActiveCompanies() async {
    final items = await auth.authedRequestList('/technician-companies');
    return items.map(TechnicianCompanySummary.fromJson).toList();
  }
}
