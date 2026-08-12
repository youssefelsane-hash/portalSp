// شركات/فرق الفنيين (docs/06 §3.8) — مطابق لـ apps/api/src/modules/technicians/dto/company-response.dto.ts.
class Company {
  final String id;
  final String ownerUserId;
  final String name;
  final String? commercialRegistrationNumber;
  final bool isActive;

  Company({
    required this.id,
    required this.ownerUserId,
    required this.name,
    required this.commercialRegistrationNumber,
    required this.isActive,
  });

  factory Company.fromJson(Map<String, dynamic> json) => Company(
        id: json['id'] as String,
        ownerUserId: json['owner_user_id'] as String,
        name: json['name'] as String,
        commercialRegistrationNumber: json['commercial_registration_number'] as String?,
        isActive: json['is_active'] as bool,
      );
}

class CompanyBranch {
  final String id;
  final String name;
  final String? addressLine;
  final bool isActive;

  CompanyBranch({required this.id, required this.name, required this.addressLine, required this.isActive});

  factory CompanyBranch.fromJson(Map<String, dynamic> json) => CompanyBranch(
        id: json['id'] as String,
        name: json['name'] as String,
        addressLine: json['address_line'] as String?,
        isActive: json['is_active'] as bool,
      );
}

class StaffMember {
  final String userId;
  final String fullName;
  final String technicianCode;
  final String teamRole;
  final String? branchId;
  final String verificationStatus;

  StaffMember({
    required this.userId,
    required this.fullName,
    required this.technicianCode,
    required this.teamRole,
    required this.branchId,
    required this.verificationStatus,
  });

  factory StaffMember.fromJson(Map<String, dynamic> json) => StaffMember(
        userId: json['user_id'] as String,
        fullName: json['full_name'] as String,
        technicianCode: json['technician_code'] as String,
        teamRole: json['team_role'] as String,
        branchId: json['branch_id'] as String?,
        verificationStatus: json['verification_status'] as String,
      );
}

class CompanyDetail {
  final Company company;
  final List<CompanyBranch> branches;
  final List<StaffMember> staff;

  CompanyDetail({required this.company, required this.branches, required this.staff});

  factory CompanyDetail.fromJson(Map<String, dynamic> json) => CompanyDetail(
        company: Company.fromJson(json['company'] as Map<String, dynamic>),
        branches: (json['branches'] as List<dynamic>)
            .map((e) => CompanyBranch.fromJson(e as Map<String, dynamic>))
            .toList(),
        staff: (json['staff'] as List<dynamic>).map((e) => StaffMember.fromJson(e as Map<String, dynamic>)).toList(),
      );
}

// مطابق لـ AddStaffDto/UpdateStaffDto's team_role — owner مش موجود هنا عمدًا (مالك واحد بس،
// بيتحدد وقت إنشاء الشركة، مش قابل للتعيين عبر إضافة عضو).
const Map<String, String> teamRoleLabelsAr = {
  'owner': 'مالك',
  'manager': 'مدير',
  'supervisor': 'مشرف',
  'worker': 'عامل',
};

const List<String> assignableTeamRoles = ['manager', 'supervisor', 'worker'];
