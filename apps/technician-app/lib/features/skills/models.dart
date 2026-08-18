// تصريح مهارات ذاتي (Script 4 §2-7) — مطابق لـ
// apps/api/src/modules/technicians/dto/technician-service-response.dto.ts.
class TechnicianServiceDeclaration {
  final String id;
  final String serviceId;
  final String skillLevel;
  final String verificationStatus;
  final bool isSelfDeclared;
  final bool isActive;
  final String? rejectionReason;
  final String createdAt;

  TechnicianServiceDeclaration({
    required this.id,
    required this.serviceId,
    required this.skillLevel,
    required this.verificationStatus,
    required this.isSelfDeclared,
    required this.isActive,
    required this.rejectionReason,
    required this.createdAt,
  });

  factory TechnicianServiceDeclaration.fromJson(Map<String, dynamic> json) =>
      TechnicianServiceDeclaration(
        id: json['id'] as String,
        serviceId: json['service_id'] as String,
        skillLevel: json['skill_level'] as String,
        verificationStatus: json['verification_status'] as String,
        isSelfDeclared: json['is_self_declared'] as bool,
        isActive: json['is_active'] as bool,
        rejectionReason: json['rejection_reason'] as String?,
        createdAt: json['created_at'] as String,
      );
}

const Map<String, String> serviceVerificationStatusLabelsAr = {
  'pending_verification': 'تحت مراجعة الإدارة',
  'approved': 'معتمدة',
  'rejected': 'مرفوضة',
  'suspended': 'موقوفة مؤقتًا',
};

const Map<String, String> skillLevelLabelsAr = {
  'beginner': 'مبتدئ',
  'standard': 'متوسط',
  'expert': 'خبير',
};

class ServiceCategoryOption {
  final String id;
  final String nameAr;

  ServiceCategoryOption({required this.id, required this.nameAr});

  factory ServiceCategoryOption.fromJson(Map<String, dynamic> json) =>
      ServiceCategoryOption(
        id: json['id'] as String,
        nameAr: json['name_ar'] as String,
      );
}

class ServiceOption {
  final String id;
  final String nameAr;

  ServiceOption({required this.id, required this.nameAr});

  factory ServiceOption.fromJson(Map<String, dynamic> json) => ServiceOption(
    id: json['id'] as String,
    nameAr: json['name_ar'] as String,
  );
}
