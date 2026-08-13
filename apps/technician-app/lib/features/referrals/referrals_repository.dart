import '../../core/auth_repository.dart';
import 'models.dart';

class ReferralsRepository {
  final AuthRepository auth;

  ReferralsRepository(this.auth);

  Future<ReferralSummary> fetchSummary() async {
    final data = await auth.authedRequest('GET', '/technician/referrals');
    return ReferralSummary.fromJson(data!);
  }
}
