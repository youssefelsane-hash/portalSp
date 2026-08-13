import '../../core/auth_repository.dart';
import 'models.dart';

class KpiRepository {
  final AuthRepository auth;

  KpiRepository(this.auth);

  Future<KpiTechnicianSummary> fetchSummary() async {
    final data = await auth.authedRequest('GET', '/technician/kpi');
    return KpiTechnicianSummary.fromJson(data!);
  }
}
