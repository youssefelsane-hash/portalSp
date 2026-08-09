import '../../core/auth_repository.dart';
import 'models.dart';

class PortfolioRepository {
  final AuthRepository auth;

  PortfolioRepository(this.auth);

  Future<List<PortfolioLink>> list() async {
    final items = await auth.authedRequestList('/technician/portfolio-links');
    return items.map(PortfolioLink.fromJson).toList();
  }

  Future<PortfolioLink> add(String url, {String? title}) async {
    final data = await auth.authedRequest('POST', '/technician/portfolio-links', body: {
      'url': url,
      if (title != null && title.isNotEmpty) 'title': title,
    });
    return PortfolioLink.fromJson(data!);
  }

  Future<void> remove(String linkId) async {
    await auth.authedRequest('DELETE', '/technician/portfolio-links/$linkId');
  }
}
