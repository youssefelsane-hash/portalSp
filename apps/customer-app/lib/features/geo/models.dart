class City {
  final String id;
  final String nameAr;
  final String nameEn;

  City({required this.id, required this.nameAr, required this.nameEn});

  factory City.fromJson(Map<String, dynamic> json) => City(
        id: json['id'] as String,
        nameAr: json['name_ar'] as String,
        nameEn: json['name_en'] as String,
      );
}

class Area {
  final String id;
  final String cityId;
  final String nameAr;
  final String nameEn;

  Area({required this.id, required this.cityId, required this.nameAr, required this.nameEn});

  factory Area.fromJson(Map<String, dynamic> json) => Area(
        id: json['id'] as String,
        cityId: json['city_id'] as String,
        nameAr: json['name_ar'] as String,
        nameEn: json['name_en'] as String,
      );
}
