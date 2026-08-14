import '../../core/auth_repository.dart';
import 'models.dart';

// نقاط الولاء — مفتوح لأي مستخدم مسجّل دخول (مفيش @Roles مخصوصة في الباك-إند).
class LoyaltyRepository {
  final AuthRepository auth;

  LoyaltyRepository(this.auth);

  Future<int> fetchBalance() async {
    final data = await auth.authedRequest('GET', '/loyalty/balance');
    return data!['points_balance'] as int;
  }

  Future<List<LoyaltyTransaction>> fetchTransactions() async {
    final items = await auth.authedRequestList('/loyalty/transactions');
    return items.map(LoyaltyTransaction.fromJson).toList();
  }

  // docs/08 §19 بند 14 — redeem() اتشالت عمدًا من هنا (تفاصيل كاملة في loyalty_screen.dart):
  // مفيش سعر صرف نقطة↔جنيه معرَّف في القاموس، فاستبدال حقيقي كان بيخصم رصيد العميل من غير أي
  // قيمة ترجعله. POST /loyalty/redeem لسه موجود وشغال في الباك-إند (مش endpoint اتشال)، بس مفيش
  // استهلاك ليه من هنا لحد ما يتحدد سعر صرف حقيقي.
}
