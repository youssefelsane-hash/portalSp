import 'package:customer_app/core/auth_repository.dart';
import 'package:customer_app/features/addresses/models.dart';
import 'package:customer_app/features/catalog/models.dart';
import 'package:customer_app/features/technicians/models.dart';
import 'package:customer_app/features/technicians/technician_marketplace_screen.dart';
import 'package:customer_app/features/technicians/technicians_repository.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _EmptyTechniciansRepository extends TechniciansRepository {
  _EmptyTechniciansRepository() : super(AuthRepository());

  @override
  Future<List<TechnicianBookingListItem>> listForService(
    String serviceId,
    String addressId, {
    String? excludeTechnicianId,
    Map<String, dynamic>? fieldValues,
    String? sort,
    DateTime? scheduledAt,
    BookingMode? bookingMode,
  }) async => <TechnicianBookingListItem>[];
}

CatalogService _service() => CatalogService(
  id: 'service-1',
  categoryId: 'category-1',
  nameAr: 'تنظيف شامل للمنزل',
  shortDescriptionAr: null,
  iconUrl: null,
  pricingModel: 'fixed',
  basePriceCents: 10000,
  inspectionFeeCents: 0,
  allowsScheduling: true,
  allowsEmergency: true,
  allowsIndividual: true,
  allowsTeam: true,
  allowsDateRangeBooking: false,
  allowsRecurringBooking: false,
  cashAllowed: true,
  schedulePrecision: 'start_time',
);

Address _address() => Address(
  id: 'address-1',
  label: 'البيت',
  cityId: 'city-1',
  areaId: 'area-1',
  serviceZoneId: 'zone-1',
  streetName: 'شارع الاختبار',
  buildingNumber: '10',
  floorNumber: null,
  apartmentNumber: null,
  landmark: null,
  latitude: 31.2,
  longitude: 29.9,
  isDefault: true,
  hasActiveOrder: false,
);

void main() {
  testWidgets(
    'اختيار الفريق يدويًا يفتح السوق على شاشة Android ضيقة بلا شاشة سوداء',
    (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          home: TechnicianMarketplaceScreen(
            service: _service(),
            address: _address(),
            bookingMode: BookingMode.team,
            repository: _EmptyTechniciansRepository(),
            onSelect: (_, _, _) async {},
          ),
        ),
      );
      await tester.pump();

      expect(tester.takeException(), isNull);
      expect(find.textContaining('اختار قائد/شركة'), findsOneWidget);
      expect(find.byType(DropdownButton<TechnicianSortOption>), findsOneWidget);
      expect(find.textContaining('مفيش فنيين متاحين'), findsOneWidget);
    },
  );
}
