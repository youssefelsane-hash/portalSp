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

// مرشّح للتجنيد (docs/08 §31/§35) — مطابق لـ OrderTeamService.listRecruitCandidates() (RecruitCandidateRow).
// isLeaderTeamMember/capacityTier جداد (ADR-0021 §2) — أولوية فريق القائد الدائم + شفافية القدرة
// الاستيعابية (LIGHT = تجنيد فوري، MEANINGFUL/HEAVY = هيتعرضله فرصة اختيارية بدل تحميل صامت).
class RecruitCandidate {
  final String technicianId;
  final String fullName;
  final String? avatarUrl;
  final String currentLevel;
  final double averageRating;
  final double? distanceKm;
  final bool isLeaderTeamMember;
  final bool isPreferredCrewMember;
  final String capacityTier;

  RecruitCandidate({
    required this.technicianId,
    required this.fullName,
    required this.avatarUrl,
    required this.currentLevel,
    required this.averageRating,
    required this.distanceKm,
    required this.isLeaderTeamMember,
    required this.isPreferredCrewMember,
    required this.capacityTier,
  });

  factory RecruitCandidate.fromJson(Map<String, dynamic> json) => RecruitCandidate(
        technicianId: json['technician_id'] as String,
        fullName: json['full_name'] as String,
        avatarUrl: json['avatar_url'] as String?,
        currentLevel: json['current_level'] as String,
        averageRating: double.tryParse(json['average_rating']?.toString() ?? '') ?? 0,
        distanceKm: json['distance_km'] != null ? (json['distance_km'] as num).toDouble() : null,
        isLeaderTeamMember: json['is_leader_team_member'] as bool? ?? false,
        isPreferredCrewMember: json['is_preferred_crew_member'] as bool? ?? false,
        capacityTier: json['capacity_tier'] as String? ?? 'LIGHT',
      );
}

// نتيجة محاولة تجنيد (docs/08 §35) — LIGHT بيتضاف فورًا (status='added')، MEANINGFUL/HEAVY
// بيتحوّل لفرصة اختيارية بدل تحميل صامت (status='offer_sent').
class RecruitOutcome {
  final String status;
  final String? opportunityId;
  final String? capacityTier;
  final List<TeamMember> items;

  RecruitOutcome({required this.status, this.opportunityId, this.capacityTier, this.items = const []});

  bool get isOfferSent => status == 'offer_sent';
}

// دعوة انضمام لفريق طلب (docs/08 §35، ADR-0021 §2) — الطلب أصلاً له قائد، الفني هنا بيتعرضله
// ينضم كعضو تحته (مش يبقى القائد، بعكس WorkOpportunity العادية). مطابق لـ
// TechnicianWorkOpportunitiesService.listCrewRecruitForTechnician().
class CrewOpportunity {
  final String id;
  final String orderId;
  final String orderNumber;
  final String serviceNameAr;
  final String? problemDescription;
  final String streetName;
  final String capacityTierAtOffer;
  final String crewRole;
  final String? teamLeaderName;
  final String? scheduledAt;

  CrewOpportunity({
    required this.id,
    required this.orderId,
    required this.orderNumber,
    required this.serviceNameAr,
    required this.problemDescription,
    required this.streetName,
    required this.capacityTierAtOffer,
    required this.crewRole,
    required this.teamLeaderName,
    required this.scheduledAt,
  });

  factory CrewOpportunity.fromJson(Map<String, dynamic> json) => CrewOpportunity(
        id: json['id'] as String,
        orderId: json['order_id'] as String,
        orderNumber: json['order_number'] as String,
        serviceNameAr: json['service_name_ar'] as String,
        problemDescription: json['problem_description'] as String?,
        streetName: json['street_name'] as String,
        capacityTierAtOffer: json['capacity_tier_at_offer'] as String,
        crewRole: json['crew_role'] as String? ?? 'technician',
        teamLeaderName: json['team_leader_name'] as String?,
        scheduledAt: json['scheduled_at'] as String?,
      );
}

const Map<String, String> crewRoleLabelsAr = {
  'technician': 'فني',
  'assistant': 'مساعد',
};

// نفس ترتيب TechnicianLevel في technician-profile.entity.ts بالحرف (docs/08 §31) — للعرض بس هنا.
const Map<String, String> technicianLevelLabelsAr = {
  'new': 'جديد',
  'verified': 'موثّق',
  'professional': 'محترف',
  'premium': 'مميّز',
  'team_leader': 'قائد فريق',
};

class OrderRescheduleRequest {
  final String id;
  final String proposedSlotId;
  final DateTime proposedAt;
  final DateTime proposedEndAt;
  final String reason;
  final String status;
  final DateTime createdAt;

  OrderRescheduleRequest({required this.id, required this.proposedSlotId, required this.proposedAt, required this.proposedEndAt, required this.reason, required this.status, required this.createdAt});

  bool get isPending => status == 'pending';

  factory OrderRescheduleRequest.fromJson(Map<String, dynamic> json) => OrderRescheduleRequest(
        id: json['id'] as String,
        proposedSlotId: json['proposed_slot_id'] as String,
        proposedAt: DateTime.parse(json['proposed_at'] as String),
        proposedEndAt: DateTime.parse(json['proposed_end_at'] as String),
        reason: json['reason'] as String,
        status: json['status'] as String,
        createdAt: DateTime.parse(json['created_at'] as String),
      );
}
