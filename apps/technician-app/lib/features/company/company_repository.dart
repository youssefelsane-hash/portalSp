import '../../core/auth_repository.dart';
import 'models.dart';

// شركات/فرق الفنيين — ذاتية الإدارة بالكامل من apps/technician-app (مفيش دور أدمن في التعديل،
// إشراف الأدمن read-only بس — راجع apps/api/src/modules/technicians/README.md).
class CompanyRepository {
  final AuthRepository auth;

  CompanyRepository(this.auth);

  // بيرمي ApiException(statusCode: 404) لو الفني مش عضو في أي شركة/فريق — الشاشة بتستخدم ده
  // عشان تقرر تعرض فورم "إنشاء شركة/فريق" بدل تفاصيل شركة موجودة.
  Future<CompanyDetail> fetchMine() async {
    final data = await auth.authedRequest('GET', '/technician/company');
    return CompanyDetail.fromJson(data!);
  }

  Future<Company> create({required String name, String? commercialRegistrationNumber}) async {
    final data = await auth.authedRequest('POST', '/technician/company', body: {
      'name': name,
      if (commercialRegistrationNumber != null && commercialRegistrationNumber.isNotEmpty)
        'commercial_registration_number': commercialRegistrationNumber,
    });
    return Company.fromJson(data!);
  }

  Future<CompanyBranch> createBranch({required String name, String? addressLine}) async {
    final data = await auth.authedRequest('POST', '/technician/company/branches', body: {
      'name': name,
      if (addressLine != null && addressLine.isNotEmpty) 'address_line': addressLine,
    });
    return CompanyBranch.fromJson(data!);
  }

  Future<StaffMember> addStaff({
    required String technicianCode,
    required String teamRole,
    String? branchId,
  }) async {
    final data = await auth.authedRequest('POST', '/technician/company/staff', body: {
      'technician_code': technicianCode,
      'team_role': teamRole,
      if (branchId != null) 'branch_id': branchId,
    });
    return StaffMember.fromJson(data!);
  }

  Future<StaffMember> updateStaffRole(String userId, String teamRole) async {
    final data = await auth.authedRequest('PATCH', '/technician/company/staff/$userId', body: {
      'team_role': teamRole,
    });
    return StaffMember.fromJson(data!);
  }

  Future<void> removeStaff(String userId) async {
    await auth.authedRequest('DELETE', '/technician/company/staff/$userId');
  }

  // §24 — كانت فجوة موثّقة: POST /technician/company/transfer-ownership موجود ومختبر بالباك-إند
  // (المالك بس يقدر يستخدمها) بس صفر استدعاء له في التطبيق — المالك مالوش طريقة يسلّم الشركة
  // إلا عبر API مباشر.
  Future<StaffMember> transferOwnership(String newOwnerUserId) async {
    final data = await auth.authedRequest('POST', '/technician/company/transfer-ownership', body: {
      'new_owner_user_id': newOwnerUserId,
    });
    return StaffMember.fromJson(data!);
  }
}
