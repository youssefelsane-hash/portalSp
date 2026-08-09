import '../../core/auth_repository.dart';
import 'models.dart';

class ReferralsRepository {
  final AuthRepository auth;

  ReferralsRepository(this.auth);

  Future<ReferralInfo> fetchMyReferralInfo() async {
    final data = await auth.authedRequest('GET', '/me/referrals');
    return ReferralInfo.fromJson(data!);
  }
}
