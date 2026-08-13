import '../../core/auth_repository.dart';
import 'models.dart';

// مطابقة المساعد التلقائية (ADR-0007) — نفس نمط OrdersRepository.fetchAvailable/accept/reject
// بالحرف، بس لفرص "شريحة مساعد" بدل "طلب كامل".
class AssistantOffersRepository {
  final AuthRepository authRepository;

  AssistantOffersRepository(this.authRepository);

  Future<List<AssistantOffer>> fetchAvailable() async {
    final items = await authRepository.authedRequestList('/technician/assistant-offers/available');
    return items.map(AssistantOffer.fromJson).toList();
  }

  Future<void> accept(String offerId) async {
    await authRepository.authedRequest('POST', '/technician/assistant-offers/$offerId/accept');
  }

  Future<void> reject(String offerId) async {
    await authRepository.authedRequest('POST', '/technician/assistant-offers/$offerId/reject');
  }
}
