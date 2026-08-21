// الفريق المفضّل (docs/08 §36.16-18، ADR-0022) — شبكة تفضيل نظير-لنظير دائمة، منفصلة تمامًا عن
// order_team_members (طاقم طلب واحد مؤقت) وtechnician_companies (توظيف رسمي) و"معاه مساعد؟"
// (assistant_link_status — علاقة واحد-لواحد محتاجة موافقة أدمن). دي بلا موافقة أدمن خالص.
class PreferredCrewMember {
  final String id;
  final String technicianId;
  final String technicianCode;
  final String fullName;
  final String status; // invited | accepted (removed/declined مش بترجع من الباك-إند أصلاً)
  final String invitedAt;
  final String? respondedAt;

  PreferredCrewMember({
    required this.id,
    required this.technicianId,
    required this.technicianCode,
    required this.fullName,
    required this.status,
    required this.invitedAt,
    required this.respondedAt,
  });

  factory PreferredCrewMember.fromJson(Map<String, dynamic> json) => PreferredCrewMember(
        id: json['id'] as String,
        technicianId: json['technician_id'] as String,
        technicianCode: json['technician_code'] as String,
        fullName: json['full_name'] as String,
        status: json['status'] as String,
        invitedAt: json['invited_at'] as String,
        respondedAt: json['responded_at'] as String?,
      );
}
