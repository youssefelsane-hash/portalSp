import '../../core/api_client.dart';
import 'models.dart';

// /cities و/cities/:id/areas عامة (Public()) — بيستخدمها فورم إضافة عنوان قبل ما يكون فيه توكن حتى.
class GeoRepository {
  Future<List<City>> fetchCities() async {
    final items = await apiRequestList('/cities');
    return items.map(City.fromJson).toList();
  }

  Future<List<Area>> fetchAreas(String cityId) async {
    final items = await apiRequestList('/cities/$cityId/areas');
    return items.map(Area.fromJson).toList();
  }
}
