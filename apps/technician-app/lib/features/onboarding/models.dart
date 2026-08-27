// اعتماد الفني الجديد (docs/02 §technician_profiles.verification_status) — مطابق لـ
// apps/api/src/modules/technicians/dto/technician-profile-response.dto.ts. الحقول اللي محتاجينها
// بس هنا (مش كل TechnicianProfileResponseDto — الباقي مستخدم في شاشات تانية مش لسه مبنية).
class TechnicianMe {
  final String technicianCode;
  final String verificationStatus;
  // ADR-0031 — آخر صورة شخصية رفعها الفني نفسه (بغض النظر عن حالة المراجعة) — بتظهر فورًا في
  // بروفايله هو، مختلفة عن الأفتار المعتمد اللي العميل بيشوفه (ده بس بعد موافقة الأدمن).
  final String? avatarUrl;
  final bool isAvailable;
  // أونلاين/أوفلاين (Script 4 §8) — is_available وis_on_duty الاتنين شرط "و" معًا في كل مكان
  // بيقرر أهلية المطابقة في الباك-إند (matching.service.ts وغيرها)، فمفيش داعي لتوجيهين منفصلين
  // للفني — زرار واحد بيبدّل الاتنين مع بعض عبر PATCH /technician/availability.
  final bool isOnDuty;
  // "معاه مساعد؟" + تصنيف نوع الفني الأربعة (docs/06 §3.7-§3.8) — محسوبين لحظياً في الباك-إند،
  // مش أعمدة مخزّنة. كانت فجوة موثّقة صراحة: مفيش شاشة في apps/technician-app كانت بتقرأهم خالص.
  final String technicianType;
  final String assistantLinkStatus;
  final String? assistantTechnicianId;
  /// هل الفني سجّل رقمه القومي؟ (ADR-0045، docs/08 §77-E1) — الرقم نفسه ما بيرجعش من
  /// السيرفر أبدًا للفني، بس الـboolean ده كافي عشان التطبيق يعرف يعرض الحقل ولا التأكيد.
  final bool nationalIdSet;

  TechnicianMe({
    required this.technicianCode,
    required this.verificationStatus,
    required this.avatarUrl,
    required this.isAvailable,
    required this.isOnDuty,
    required this.technicianType,
    required this.assistantLinkStatus,
    required this.assistantTechnicianId,
    required this.nationalIdSet,
  });

  factory TechnicianMe.fromJson(Map<String, dynamic> json) => TechnicianMe(
    technicianCode: json['technician_code'] as String,
    verificationStatus: json['verification_status'] as String,
    avatarUrl: json['avatar_url'] as String?,
    isAvailable: json['is_available'] as bool,
    isOnDuty: json['is_on_duty'] as bool,
    technicianType: json['technician_type'] as String,
    assistantLinkStatus: json['assistant_link_status'] as String,
    assistantTechnicianId: json['assistant_technician_id'] as String?,
    nationalIdSet: json['national_id_set'] as bool? ?? false,
  );
}

// مطابق لـ TechniciansService.classifyType() بالحرف — راجع technicians/README.md.
const Map<String, String> technicianTypeLabelsAr = {
  'individual': 'فني مستقل',
  'individual_with_assistant': 'فني مستقل + مساعد',
  'team': 'عضو فريق',
  'company': 'عضو شركة',
};

const Map<String, String> assistantLinkStatusLabelsAr = {
  'none': 'مفيش مساعد مربوط',
  'pending_approval': 'طلب الربط قيد مراجعة الإدارة',
  'approved': 'مساعدك مربوط ومعتمد',
};

// نفس enum التسلسل الحقيقي (TechnicianVerificationStatus في الباك-إند) بترتيبه — عشان نعرف
// نعرض للفني هو "لسه بيراجع" ولا "خلاص محتاج يعمل حاجة تانية" ولا "رجع مرفوض".
const Map<String, String> verificationStatusLabelsAr = {
  'pending': 'لسه محتاج ترفع مستنداتك',
  'documents_submitted': 'مستنداتك اتبعتت — مستنية المراجعة',
  'under_review': 'حسابك تحت المراجعة',
  'interview_scheduled': 'اتحدد ميعاد مقابلة معاك',
  'test_passed': 'عدّيت الاختبار — الخطوة الأخيرة قبل الاعتماد',
  'approved': 'حسابك معتمد',
  'rejected': 'الطلب اترفض',
  'suspended': 'حسابك متوقف مؤقتًا',
};

// مطابق لـ apps/api/src/modules/technicians/entities/technician-document.entity.ts's
// TechnicianDocumentType — نفس القيم بالحرف، مطلوبة كـenum صريح في UploadDocumentDto.
const Map<String, String> documentTypeLabelsAr = {
  'national_id_front': 'البطاقة الشخصية (وش)',
  'national_id_back': 'البطاقة الشخصية (ضهر)',
  'criminal_record': 'فيش وتشبيه',
  'professional_certificate': 'شهادة مهنية',
  'photo': 'صورة شخصية',
  'driving_license': 'رخصة قيادة',
  'vehicle_license': 'رخصة مركبة',
};

class TechnicianDocument {
  final String id;
  final String documentType;
  final String fileUrl;
  final String reviewStatus;
  final String? rejectionReason;
  final String? expiresAt;

  TechnicianDocument({
    required this.id,
    required this.documentType,
    required this.fileUrl,
    required this.reviewStatus,
    required this.rejectionReason,
    required this.expiresAt,
  });

  factory TechnicianDocument.fromJson(Map<String, dynamic> json) =>
      TechnicianDocument(
        id: json['id'] as String,
        documentType: json['document_type'] as String,
        fileUrl: json['file_url'] as String,
        reviewStatus: json['review_status'] as String,
        rejectionReason: json['rejection_reason'] as String?,
        expiresAt: json['expires_at'] as String?,
      );
}

const Map<String, String> documentReviewStatusLabelsAr = {
  'pending': 'مستنية المراجعة',
  'approved': 'معتمدة',
  'rejected': 'مرفوضة',
};
