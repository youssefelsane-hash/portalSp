import '../../core/auth_repository.dart';
import 'models.dart';

class AddressesRepository {
  final AuthRepository auth;

  AddressesRepository(this.auth);

  Future<List<Address>> list() async {
    final items = await auth.authedRequestList('/addresses');
    return items.map(Address.fromJson).toList();
  }

  Future<Address> create({
    required String cityId,
    required String areaId,
    required String streetName,
    required double latitude,
    required double longitude,
    String? label,
    String? buildingNumber,
    String? floorNumber,
    String? apartmentNumber,
    String? landmark,
    bool? isDefault,
  }) async {
    final data = await auth.authedRequest('POST', '/addresses', body: {
      'city_id': cityId,
      'area_id': areaId,
      'street_name': streetName,
      'latitude': latitude,
      'longitude': longitude,
      if (label != null && label.isNotEmpty) 'label': label,
      if (buildingNumber != null && buildingNumber.isNotEmpty) 'building_number': buildingNumber,
      if (floorNumber != null && floorNumber.isNotEmpty) 'floor_number': floorNumber,
      if (apartmentNumber != null && apartmentNumber.isNotEmpty) 'apartment_number': apartmentNumber,
      if (landmark != null && landmark.isNotEmpty) 'landmark': landmark,
      if (isDefault != null) 'is_default': isDefault,
    });
    return Address.fromJson(data!);
  }

  Future<void> remove(String addressId) async {
    await auth.authedRequest('DELETE', '/addresses/$addressId');
  }
}
