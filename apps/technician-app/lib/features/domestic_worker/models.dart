// بروفايل الشغالة/العامل المنزلي (docs/08 §12, ADR-0004, ADR-0005) — مطابق لـ
// apps/api/src/modules/domestic-workers/dto/worker-response.dto.ts وworker-booking-response.dto.ts.

const Map<String, String> specialtyLabelsAr = {
  'cleaning_hourly': 'تنظيف بالساعة',
  'babysitting_hourly': 'جليسة أطفال بالساعة',
  'live_in_maid_monthly': 'مقيمة شهرية',
};

const Map<String, String> workerVerificationStatusLabelsAr = {
  'pending': 'بروفايلك لسه محتاج مراجعة',
  'approved': 'حسابك معتمد',
  'rejected': 'الطلب اترفض',
  'suspended': 'حسابك متوقف مؤقتًا',
};

const Map<String, String> bookingStatusLabelsAr = {
  'pending_confirmation': 'محتاج تأكيدك',
  'confirmed': 'مؤكّد',
  'active': 'شغّالة',
  'completed': 'اكتمل',
  'cancelled': 'ملغي',
};

class WorkerMe {
  final String id;
  final String workerCode;
  final String? bio;
  final int yearsOfExperience;
  final List<String> specialties;
  final int? hourlyRateCents;
  final int? monthlyRateCents;
  final String verificationStatus;
  final String? verificationNotes;
  final bool isAvailable;

  WorkerMe({
    required this.id,
    required this.workerCode,
    required this.bio,
    required this.yearsOfExperience,
    required this.specialties,
    required this.hourlyRateCents,
    required this.monthlyRateCents,
    required this.verificationStatus,
    required this.verificationNotes,
    required this.isAvailable,
  });

  factory WorkerMe.fromJson(Map<String, dynamic> json) => WorkerMe(
        id: json['id'] as String,
        workerCode: json['worker_code'] as String,
        bio: json['bio'] as String?,
        yearsOfExperience: json['years_of_experience'] as int,
        specialties: (json['specialties'] as List<dynamic>).cast<String>(),
        hourlyRateCents: json['hourly_rate_cents'] as int?,
        monthlyRateCents: json['monthly_rate_cents'] as int?,
        verificationStatus: json['verification_status'] as String,
        verificationNotes: json['verification_notes'] as String?,
        isAvailable: json['is_available'] as bool,
      );
}

class WorkerBooking {
  final String id;
  final String bookingNumber;
  final String specialty;
  final String bookingType;
  final String scheduledAt;
  final int? durationHours;
  final int priceCents;
  final String status;

  WorkerBooking({
    required this.id,
    required this.bookingNumber,
    required this.specialty,
    required this.bookingType,
    required this.scheduledAt,
    required this.durationHours,
    required this.priceCents,
    required this.status,
  });

  factory WorkerBooking.fromJson(Map<String, dynamic> json) => WorkerBooking(
        id: json['id'] as String,
        bookingNumber: json['booking_number'] as String,
        specialty: json['specialty'] as String,
        bookingType: json['booking_type'] as String,
        scheduledAt: json['scheduled_at'] as String,
        durationHours: json['duration_hours'] as int?,
        priceCents: json['price_cents'] as int,
        status: json['status'] as String,
      );
}
