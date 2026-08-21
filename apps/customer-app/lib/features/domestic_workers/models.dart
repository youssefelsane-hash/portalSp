// قطاع الخدمات المنزلية (docs/08 §12, ADR-0004) — كيان مستقل تمامًا عن orders/technicians.
// مطابق لـ apps/api/src/modules/domestic-workers/dto/*.ts.

const Map<String, String> specialtyLabelsAr = {
  'cleaning_hourly': 'تنظيف بالساعة',
  'babysitting_hourly': 'جليسة أطفال بالساعة',
  'live_in_maid_monthly': 'مقيمة شهرية',
};

const Map<String, String> bookingTypeLabelsAr = {
  'hourly': 'بالساعة',
  'monthly_live_in': 'إقامة شهرية',
};

const Map<String, String> bookingStatusLabelsAr = {
  'pending_confirmation': 'في انتظار موافقة مقدّم الخدمة',
  'confirmed': 'اتأكد',
  'active': 'شغّال',
  'completed': 'اكتمل',
  'cancelled': 'ملغي',
};

class PublicWorker {
  final String id;
  final String workerCode;
  final String fullName;
  final String? bio;
  final int yearsOfExperience;
  final List<String> specialties;
  final int? hourlyRateCents;
  final int? monthlyRateCents;
  final double averageRating;
  final int totalRatingsCount;
  final int completedBookingsCount;
  final double? distanceKm;
  // سياسة إظهار المرشّحين المتعارضين جدوليًا (ADR-0030 Slice C/D) — 'available' دايمًا لو
  // البحث بلا معاد محدد. لو اتحدد معاد وService لسه مربوطش بسياق خدمة كتالوج معروف في مسار
  // التصفّح ده (فجوة معمارية موثّقة صراحة في ADR-0030)، الشغالة المتعارضة بتتفلتر برّه القايمة
  // بدل ما تترجع بحالة schedule_conflicted — فالحقل ده حاليًا 'available' دايمًا فعليًا هنا.
  final String availabilityStatus;
  final String? unavailableReasonAr;
  final DateTime? availableAgainAt;

  PublicWorker({
    required this.id,
    required this.workerCode,
    required this.fullName,
    required this.bio,
    required this.yearsOfExperience,
    required this.specialties,
    required this.hourlyRateCents,
    required this.monthlyRateCents,
    required this.averageRating,
    required this.totalRatingsCount,
    required this.completedBookingsCount,
    required this.distanceKm,
    this.availabilityStatus = 'available',
    this.unavailableReasonAr,
    this.availableAgainAt,
  });

  factory PublicWorker.fromJson(Map<String, dynamic> json) => PublicWorker(
        id: json['id'] as String,
        workerCode: json['worker_code'] as String,
        fullName: json['full_name'] as String,
        bio: json['bio'] as String?,
        yearsOfExperience: json['years_of_experience'] as int,
        specialties: (json['specialties'] as List<dynamic>).cast<String>(),
        hourlyRateCents: json['hourly_rate_cents'] as int?,
        monthlyRateCents: json['monthly_rate_cents'] as int?,
        averageRating: (json['average_rating'] as num).toDouble(),
        totalRatingsCount: json['total_ratings_count'] as int,
        completedBookingsCount: json['completed_bookings_count'] as int,
        distanceKm: (json['distance_km'] as num?)?.toDouble(),
        availabilityStatus: json['availability_status'] as String? ?? 'available',
        unavailableReasonAr: json['unavailable_reason_ar'] as String?,
        availableAgainAt:
            json['available_again_at'] != null ? DateTime.parse(json['available_again_at'] as String) : null,
      );
}

class WorkerBooking {
  final String id;
  final String bookingNumber;
  final String workerId;
  final String specialty;
  final String bookingType;
  final String scheduledAt;
  final int? durationHours;
  final int priceCents;
  final String status;
  final String? cancellationReason;

  WorkerBooking({
    required this.id,
    required this.bookingNumber,
    required this.workerId,
    required this.specialty,
    required this.bookingType,
    required this.scheduledAt,
    required this.durationHours,
    required this.priceCents,
    required this.status,
    required this.cancellationReason,
  });

  factory WorkerBooking.fromJson(Map<String, dynamic> json) => WorkerBooking(
        id: json['id'] as String,
        bookingNumber: json['booking_number'] as String,
        workerId: json['worker_id'] as String,
        specialty: json['specialty'] as String,
        bookingType: json['booking_type'] as String,
        scheduledAt: json['scheduled_at'] as String,
        durationHours: json['duration_hours'] as int?,
        priceCents: json['price_cents'] as int,
        status: json['status'] as String,
        cancellationReason: json['cancellation_reason'] as String?,
      );
}

const Set<String> cancellableBookingStatuses = {'pending_confirmation', 'confirmed', 'active'};
