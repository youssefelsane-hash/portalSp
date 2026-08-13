import '../../core/auth_repository.dart';
import 'models.dart';

// المفضّلة (Favorites) — العميل بس، مفتوح لأي عميل مسجّل دخول.
class FavoritesRepository {
  final AuthRepository auth;

  FavoritesRepository(this.auth);

  Future<List<FavoriteTechnician>> listFavorites() async {
    final items = await auth.authedRequestList('/me/favorites/technicians');
    return items.map(FavoriteTechnician.fromJson).toList();
  }

  Future<bool> isFavorited(String technicianId) async {
    final data = await auth.authedRequest('GET', '/me/favorites/technicians/$technicianId/status');
    return data!['is_favorited'] as bool;
  }

  Future<bool> addFavorite(String technicianId) async {
    final data = await auth.authedRequest('POST', '/me/favorites/technicians/$technicianId');
    return data!['is_favorited'] as bool;
  }

  Future<bool> removeFavorite(String technicianId) async {
    final data = await auth.authedRequest('DELETE', '/me/favorites/technicians/$technicianId');
    return data!['is_favorited'] as bool;
  }
}
