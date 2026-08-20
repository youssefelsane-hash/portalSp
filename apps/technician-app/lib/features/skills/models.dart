// تصريح تخصص ذاتي بمستوى الفئة الكاملة (سباكة/كهرباء/...) — §29، بدّل التصريح خدمة-بخدمة
// القديم بالكامل (طلب مالك صريح 2026-08-20: أي خدمة جديدة تتضاف تحت فئة معتمدة للفني تبقى متاحة
// له تلقائيًا، بلا أي تصريح إضافي لكل خدمة لوحدها). مطابق لـ
// apps/api/src/modules/technicians/dto/technician-category-response.dto.ts.
class TechnicianCategoryDeclaration {
  final String id;
  final String categoryId;
  final String verificationStatus;
  final bool isSelfDeclared;
  final bool isActive;
  final String? rejectionReason;
  final String createdAt;

  TechnicianCategoryDeclaration({
    required this.id,
    required this.categoryId,
    required this.verificationStatus,
    required this.isSelfDeclared,
    required this.isActive,
    required this.rejectionReason,
    required this.createdAt,
  });

  factory TechnicianCategoryDeclaration.fromJson(Map<String, dynamic> json) =>
      TechnicianCategoryDeclaration(
        id: json['id'] as String,
        categoryId: json['category_id'] as String,
        verificationStatus: json['verification_status'] as String,
        isSelfDeclared: json['is_self_declared'] as bool,
        isActive: json['is_active'] as bool,
        rejectionReason: json['rejection_reason'] as String?,
        createdAt: json['created_at'] as String,
      );
}

const Map<String, String> categoryVerificationStatusLabelsAr = {
  'pending_verification': 'تحت مراجعة الإدارة',
  'approved': 'معتمد',
  'rejected': 'مرفوض',
  'suspended': 'موقوف مؤقتًا',
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
