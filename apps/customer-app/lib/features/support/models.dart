// فئات الشكوى (docs/08 §19 بند 13) — مطابقة بالحرف لـComplaintCategory في
// apps/api/src/modules/support/entities/complaint.entity.ts.
enum ComplaintCategory {
  poorQuality('poor_quality', 'جودة الشغل ضعيفة'),
  lateArrival('late_arrival', 'تأخير الفني'),
  noShow('no_show', 'الفني ملحقش يجي خالص'),
  overcharging('overcharging', 'اتحاسبت زيادة عن المتفق عليه'),
  rudeBehavior('rude_behavior', 'سلوك غير لائق من الفني'),
  damageToProperty('damage_to_property', 'ضرر في الممتلكات'),
  incompleteWork('incomplete_work', 'الشغل مخلصش'),
  safetyConcern('safety_concern', 'مشكلة أمان'),
  fraud('fraud', 'احتيال'),
  other('other', 'حاجة تانية');

  final String apiValue;
  final String labelAr;
  const ComplaintCategory(this.apiValue, this.labelAr);

  static ComplaintCategory fromApiValue(String value) =>
      ComplaintCategory.values.firstWhere((c) => c.apiValue == value, orElse: () => ComplaintCategory.other);
}

const Map<String, String> complaintStatusLabelsAr = {
  'open': 'مفتوحة',
  'under_investigation': 'قيد المراجعة',
  'awaiting_customer': 'مستنية ردّك',
  'awaiting_technician': 'مستنية رد الفني',
  'resolved': 'اتحلّت',
  'rejected': 'مرفوضة',
  'escalated': 'مُصعَّدة',
  'closed': 'مقفولة',
};

class Complaint {
  final String id;
  final String complaintNumber;
  final String? orderId;
  final String category;
  final String severity;
  final String title;
  final String description;
  final String complaintStatus;
  final String? resolutionType;
  final String? resolutionNotes;
  final int compensationCents;
  final DateTime createdAt;

  Complaint({
    required this.id,
    required this.complaintNumber,
    required this.orderId,
    required this.category,
    required this.severity,
    required this.title,
    required this.description,
    required this.complaintStatus,
    required this.resolutionType,
    required this.resolutionNotes,
    required this.compensationCents,
    required this.createdAt,
  });

  factory Complaint.fromJson(Map<String, dynamic> json) => Complaint(
        id: json['id'] as String,
        complaintNumber: json['complaint_number'] as String,
        orderId: json['order_id'] as String?,
        category: json['category'] as String,
        severity: json['severity'] as String,
        title: json['title'] as String,
        description: json['description'] as String,
        complaintStatus: json['complaint_status'] as String,
        resolutionType: json['resolution_type'] as String?,
        resolutionNotes: json['resolution_notes'] as String?,
        compensationCents: json['compensation_cents'] as int? ?? 0,
        createdAt: DateTime.parse(json['created_at'] as String),
      );
}

class ComplaintMessage {
  final String id;
  final String senderRole;
  final String message;
  final DateTime createdAt;

  ComplaintMessage({required this.id, required this.senderRole, required this.message, required this.createdAt});

  factory ComplaintMessage.fromJson(Map<String, dynamic> json) => ComplaintMessage(
        id: json['id'] as String,
        senderRole: json['sender_role'] as String,
        message: json['message'] as String,
        createdAt: DateTime.parse(json['created_at'] as String),
      );
}

class ComplaintAttachment {
  final String id;
  final String fileUrl;
  final String? fileType;

  ComplaintAttachment({required this.id, required this.fileUrl, required this.fileType});

  factory ComplaintAttachment.fromJson(Map<String, dynamic> json) => ComplaintAttachment(
        id: json['id'] as String,
        fileUrl: json['file_url'] as String,
        fileType: json['file_type'] as String?,
      );
}
