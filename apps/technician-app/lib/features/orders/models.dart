// سياسة إلغاء الفني (docs/10) — مطابق لـ apps/api/src/modules/orders/dto/cancellation-reason-response.dto.ts.
// GET /cancellation-reasons?applies_to=technician بيرجّع القايمة دي.
class CancellationReason {
  final String id;
  final String reasonAr;
  final bool chargesFee;
  final double feePercentage;
  final bool requiresFreeText;

  CancellationReason({
    required this.id,
    required this.reasonAr,
    required this.chargesFee,
    required this.feePercentage,
    required this.requiresFreeText,
  });

  factory CancellationReason.fromJson(Map<String, dynamic> json) => CancellationReason(
        id: json['id'] as String,
        reasonAr: json['reason_ar'] as String,
        chargesFee: json['charges_fee'] as bool,
        feePercentage: double.parse(json['fee_percentage'].toString()),
        requiresFreeText: json['requires_free_text'] as bool,
      );
}

// مطابق لـ apps/api/src/modules/orders/dto/technician-cancellation-policy-response.dto.ts —
// استشاري بس (الفرض الحقيقي جوّه الباك-إند)، بيحدد هل زرار "إلغاء الطلب" يظهر أصلاً.
class CancellationPolicy {
  final bool canCancel;
  final String? reasonIfNot;
  final DateTime? windowExpiresAt;

  CancellationPolicy({required this.canCancel, required this.reasonIfNot, required this.windowExpiresAt});

  factory CancellationPolicy.fromJson(Map<String, dynamic> json) => CancellationPolicy(
        canCancel: json['can_cancel'] as bool,
        reasonIfNot: json['reason_if_not'] as String?,
        windowExpiresAt: json['window_expires_at'] != null ? DateTime.parse(json['window_expires_at'] as String) : null,
      );
}

// مطابق لـ apps/api/src/modules/matching/matching.service.ts (AvailableOrderRow)
class AvailableOrder {
  final String assignmentId;
  final String orderId;
  final String orderNumber;
  final String serviceNameAr;
  final String? problemDescription;
  final String streetName;
  final String? landmark;
  final double distanceKm;
  final DateTime expiresAt;

  AvailableOrder({
    required this.assignmentId,
    required this.orderId,
    required this.orderNumber,
    required this.serviceNameAr,
    required this.problemDescription,
    required this.streetName,
    required this.landmark,
    required this.distanceKm,
    required this.expiresAt,
  });

  factory AvailableOrder.fromJson(Map<String, dynamic> json) => AvailableOrder(
        assignmentId: json['assignment_id'] as String,
        orderId: json['order_id'] as String,
        orderNumber: json['order_number'] as String,
        serviceNameAr: json['service_name_ar'] as String,
        problemDescription: json['problem_description'] as String?,
        streetName: json['street_name'] as String,
        landmark: json['landmark'] as String?,
        distanceKm: double.parse(json['distance_km'].toString()),
        expiresAt: DateTime.parse(json['expires_at'] as String),
      );
}

// طلب شغل إضافي اختياري (docs/08 §34.1b، ADR-0020) — منفصل تمامًا عن AvailableOrder فوق (بث
// الطوارئ، order_assignments): مفيش expires_at (الفرصة تفضل صالحة لحد القبول/الرفض/الطلب يتغطى
// من فني تاني)، ومطابق لـ TechnicianWorkOpportunitiesService.listForTechnician() في الباك-إند.
class WorkOpportunity {
  final String id;
  final String orderId;
  final String orderNumber;
  final String serviceNameAr;
  final String? problemDescription;
  final String streetName;
  final String capacityTierAtOffer;
  final String? scheduledAt;

  WorkOpportunity({
    required this.id,
    required this.orderId,
    required this.orderNumber,
    required this.serviceNameAr,
    required this.problemDescription,
    required this.streetName,
    required this.capacityTierAtOffer,
    required this.scheduledAt,
  });

  factory WorkOpportunity.fromJson(Map<String, dynamic> json) => WorkOpportunity(
        id: json['id'] as String,
        orderId: json['order_id'] as String,
        orderNumber: json['order_number'] as String,
        serviceNameAr: json['service_name_ar'] as String,
        problemDescription: json['problem_description'] as String?,
        streetName: json['street_name'] as String,
        capacityTierAtOffer: json['capacity_tier_at_offer'] as String,
        scheduledAt: json['scheduled_at'] as String?,
      );
}

// طاقم الطلب (docs/08 §5) — كانت فجوة موثّقة صراحة (Script 7 Phase 13/14): الباك-إند عنده
// GET/POST/DELETE .../team-members جاهزة ومؤمّنة بالفعل (technician-order-execution.controller.ts)
// بس apps/technician-app ما كانتش بتستخدمها خالص — فني قائد على طلب "اعتماد" (booking_mode=team)
// معندوش أي رؤية لطاقمه (مين المُعيّن، الطلب مكتمل ولا لسه ناقص). مطابق لـ
// apps/api/src/modules/orders/dto/team-member-response.dto.ts.
class TeamMember {
  final String id;
  final String technicianId;
  final String fullName;
  final String? avatarUrl;
  final String roleLabel;
  final String memberType;

  TeamMember({
    required this.id,
    required this.technicianId,
    required this.fullName,
    required this.avatarUrl,
    required this.roleLabel,
    required this.memberType,
  });

  factory TeamMember.fromJson(Map<String, dynamic> json) => TeamMember(
        id: json['id'] as String,
        technicianId: json['technician_id'] as String,
        fullName: json['full_name'] as String,
        avatarUrl: json['avatar_url'] as String?,
        roleLabel: json['role_label'] as String,
        memberType: json['member_type'] as String,
      );
}

// مرشّح للتجنيد الذاتي (docs/08 §31) — مطابق لـ OrderTeamService.listRecruitCandidates() (RecruitCandidateRow).
class RecruitCandidate {
  final String technicianId;
  final String fullName;
  final String? avatarUrl;
  final String currentLevel;
  final double averageRating;
  final double? distanceKm;

  RecruitCandidate({
    required this.technicianId,
    required this.fullName,
    required this.avatarUrl,
    required this.currentLevel,
    required this.averageRating,
    required this.distanceKm,
  });

  factory RecruitCandidate.fromJson(Map<String, dynamic> json) => RecruitCandidate(
        technicianId: json['technician_id'] as String,
        fullName: json['full_name'] as String,
        avatarUrl: json['avatar_url'] as String?,
        currentLevel: json['current_level'] as String,
        averageRating: double.tryParse(json['average_rating']?.toString() ?? '') ?? 0,
        distanceKm: json['distance_km'] != null ? (json['distance_km'] as num).toDouble() : null,
      );
}

// نفس ترتيب TechnicianLevel في technician-profile.entity.ts بالحرف (docs/08 §31) — للعرض بس هنا.
const Map<String, String> technicianLevelLabelsAr = {
  'new': 'جديد',
  'verified': 'موثّق',
  'professional': 'محترف',
  'premium': 'مميّز',
  'team_leader': 'قائد فريق',
};
