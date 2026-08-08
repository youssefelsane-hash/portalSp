class Address {
  final String id;
  final String? label;
  final String? cityId;
  final String? areaId;
  final String streetName;
  final String? buildingNumber;
  final String? floorNumber;
  final String? apartmentNumber;
  final String? landmark;
  final double latitude;
  final double longitude;
  final bool isDefault;

  Address({
    required this.id,
    required this.label,
    required this.cityId,
    required this.areaId,
    required this.streetName,
    required this.buildingNumber,
    required this.floorNumber,
    required this.apartmentNumber,
    required this.landmark,
    required this.latitude,
    required this.longitude,
    required this.isDefault,
  });

  factory Address.fromJson(Map<String, dynamic> json) => Address(
        id: json['id'] as String,
        label: json['label'] as String?,
        cityId: json['city_id'] as String?,
        areaId: json['area_id'] as String?,
        streetName: json['street_name'] as String,
        buildingNumber: json['building_number'] as String?,
        floorNumber: json['floor_number'] as String?,
        apartmentNumber: json['apartment_number'] as String?,
        landmark: json['landmark'] as String?,
        latitude: (json['latitude'] as num).toDouble(),
        longitude: (json['longitude'] as num).toDouble(),
        isDefault: json['is_default'] as bool,
      );

  String get displayTitle => label?.isNotEmpty == true ? label! : streetName;
}
