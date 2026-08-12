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

  // مفيش تحويل تلقائي للنقاط لخصم فعلي على الطلب — القاموس مالوش سعر صرف محدد للنقطة، فمش
  // هنخترعه هنا. مجرد خصم رصيد وتسجيل معاملة (راجع تعليق RedeemLoyaltyPointsDto في الباك-إند).
  Future<int> redeem(int points) async {
    final data = await auth.authedRequest('POST', '/loyalty/redeem', body: {'points': points});
    return data!['points_balance'] as int;
  }
}
