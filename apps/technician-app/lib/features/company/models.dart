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

// مساحة عمل الشركة (ADR-0033) — مطابق لـCompanyOrderSummaryResponseDto بالباك-إند. نظرة عامة/
// متابعة بس (رقم طلب، خدمة، حالة، موعد، فني مسؤول، منطقة، إجمالي) — مش تفاصيل تنفيذ كاملة.
class CompanyOrderSummary {
  final String id;
  final String orderNumber;
  final String serviceNameAr;
  final String orderStatus;
  final String bookingMode;
  final DateTime? scheduledAt;
  final DateTime createdAt;
  final String? technicianName;
  final String? zoneNameAr;
  final int totalAmountCents;

  CompanyOrderSummary({
    required this.id,
    required this.orderNumber,
    required this.serviceNameAr,
    required this.orderStatus,
    required this.bookingMode,
    required this.scheduledAt,
    required this.createdAt,
    required this.technicianName,
    required this.zoneNameAr,
    required this.totalAmountCents,
  });

  factory CompanyOrderSummary.fromJson(Map<String, dynamic> json) => CompanyOrderSummary(
        id: json['id'] as String,
        orderNumber: json['order_number'] as String,
        serviceNameAr: json['service_name_ar'] as String,
        orderStatus: json['order_status'] as String,
        bookingMode: json['booking_mode'] as String,
        scheduledAt: json['scheduled_at'] != null ? DateTime.parse(json['scheduled_at'] as String) : null,
        createdAt: DateTime.parse(json['created_at'] as String),
        technicianName: json['technician_name'] as String?,
        zoneNameAr: json['zone_name_ar'] as String?,
        totalAmountCents: json['total_amount_cents'] as int,
      );
}

// نفس تجميع ACTIVE_TECHNICIAN_ORDER_STATUSES بالباك-إند (order-state-machine.ts)، مترجم للعرض بس.
const Set<String> activeCompanyOrderStatuses = {
  'accepted',
  'technician_on_way',
  'technician_arrived',
  'in_progress',
  'awaiting_quote_approval',
};

const Map<String, String> orderStatusLabelsAr = {
  'draft': 'مسودة',
  'pending_payment': 'في انتظار الدفع',
  'searching_technician': 'بيدوّر على فني',
  'technician_assigned': 'اتعيّن فني',
  'accepted': 'مؤكّد',
  'technician_on_way': 'الفني في الطريق',
  'technician_arrived': 'الفني وصل',
  'in_progress': 'جاري التنفيذ',
  'awaiting_quote_approval': 'مستني موافقة عرض سعر',
  'work_completed': 'الشغل خلص',
  'awaiting_payment': 'مستني الدفع',
  'completed': 'مكتمل',
  'cancelled_by_customer': 'ألغاه العميل',
  'cancelled_by_technician': 'ألغاه الفني',
  'cancelled_by_system': 'اتلغى تلقائيًا',
  'expired': 'انتهت صلاحيته',
  'disputed': 'متنازع عليه',
  'refunded': 'مسترد',
  'awaiting_technician_reselection': 'مستني اختيار فني تاني',
};
