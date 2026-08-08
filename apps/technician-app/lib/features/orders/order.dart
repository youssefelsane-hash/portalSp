// مطابق لـ apps/api/src/modules/orders/dto/order-response.dto.ts (OrderAddressResponseDto) —
// لزرار "افتح الملاحة" في شاشة تنفيذ الطلب.
class OrderAddress {
  final String streetName;
  final String? landmark;
  final double latitude;
  final double longitude;

  OrderAddress({
    required this.streetName,
    required this.landmark,
    required this.latitude,
    required this.longitude,
  });

  factory OrderAddress.fromJson(Map<String, dynamic> json) => OrderAddress(
        streetName: json['street_name'] as String,
        landmark: json['landmark'] as String?,
        latitude: (json['latitude'] as num).toDouble(),
        longitude: (json['longitude'] as num).toDouble(),
      );
}

// مطابق لـ apps/api/src/modules/orders/dto/order-response.dto.ts — نسخة الفني (منفصلة عن
// AvailableOrder اللي بيرجعها /technician/orders/available، ده الشكل الكامل اللي كل فعل
// (accept/depart/arrive/start/complete) بيرجّعه بعد تنفيذه).
class Order {
  final String id;
  final String orderNumber;
  final String orderStatus;
  final String? problemDescription;
  final int totalAmountCents;
  final String paymentStatus;
  final OrderAddress? address;

  Order({
    required this.id,
    required this.orderNumber,
    required this.orderStatus,
    required this.problemDescription,
    required this.totalAmountCents,
    required this.paymentStatus,
    this.address,
  });

  factory Order.fromJson(Map<String, dynamic> json) => Order(
        id: json['id'] as String,
        orderNumber: json['order_number'] as String,
        orderStatus: json['order_status'] as String,
        problemDescription: json['problem_description'] as String?,
        totalAmountCents: json['total_amount_cents'] as int,
        paymentStatus: json['payment_status'] as String,
        address: json['address'] != null
            ? OrderAddress.fromJson(json['address'] as Map<String, dynamic>)
            : null,
      );
}

// تسلسل دورة عمل الفني بعد القبول — مطابق لـ order-state-machine.ts بالظبط
// (accepted -> technician_on_way -> technician_arrived -> in_progress -> work_completed).
const Map<String, String> technicianOrderStatusLabelsAr = {
  'accepted': 'قبلت الطلب',
  'technician_on_way': 'في الطريق',
  'technician_arrived': 'وصلت',
  'in_progress': 'الشغل شغّال',
  'work_completed': 'الشغل خلص — محتاج تحصيل',
  'awaiting_payment': 'في انتظار الدفع',
  'completed': 'اتقفل',
};

// الفعل الجاي المتاح لكل حالة — null يعني مفيش فعل تنفيذي جاي (لازم تحصيل كاش أو دفع العميل).
const Map<String, String?> nextTechnicianAction = {
  'accepted': 'depart',
  'technician_on_way': 'arrive',
  'technician_arrived': 'start',
  'in_progress': 'complete',
  'work_completed': 'collect_cash',
};

const Map<String, String> technicianActionLabelsAr = {
  'depart': 'انطلقت للعنوان',
  'arrive': 'وصلت',
  'start': 'ابدأ الشغل',
  'complete': 'الشغل خلص',
  'collect_cash': 'حصّلت الكاش',
};
