import '../../core/auth_repository.dart';
import 'models.dart';

// شكاوى الفني (§24 — تدقيق الاكتمال الداخلي) — كانت فجوة موثّقة صراحة: الباك-إند (complaints
// module) بيعتبر الفني طرف كامل من زمان (@Roles(CUSTOMER, TECHNICIAN) على كل الـendpoints) بلا
// أي شاشة في apps/technician-app تستخدمه — الفني مكانش يقدر يفتح شكوى أو يشوف شكاوى مفتوحة ضده
// من جوّه التطبيق أصلاً. نفس نمط apps/customer-app/lib/features/support/support_repository.dart
// بالحرف — نفس الـAPI contract بالظبط، الطرفين بيستخدموا نفس endpoints.
class SupportRepository {
  final AuthRepository auth;

  SupportRepository(this.auth);

  Future<List<Complaint>> listMine() async {
    final items = await auth.authedRequestList('/complaints');
    return items.map(Complaint.fromJson).toList();
  }

  Future<Complaint> getOne(String complaintId) async {
    final data = await auth.authedRequest('GET', '/complaints/$complaintId');
    return Complaint.fromJson(data!);
  }

  Future<Complaint> file({
    String? orderId,
    required ComplaintCategory category,
    required String title,
    required String description,
  }) async {
    final data = await auth.authedRequest('POST', '/complaints', body: {
      if (orderId != null) 'order_id': orderId,
      'category': category.apiValue,
      'title': title,
      'description': description,
    });
    return Complaint.fromJson(data!);
  }

  Future<List<ComplaintMessage>> listMessages(String complaintId) async {
    final items = await auth.authedRequestList('/complaints/$complaintId/messages');
    return items.map(ComplaintMessage.fromJson).toList();
  }

  Future<ComplaintMessage> addMessage(String complaintId, String message) async {
    final data = await auth.authedRequest('POST', '/complaints/$complaintId/messages', body: {'message': message});
    return ComplaintMessage.fromJson(data!);
  }

  Future<List<ComplaintAttachment>> listAttachments(String complaintId) async {
    final items = await auth.authedRequestList('/complaints/$complaintId/attachments');
    return items.map(ComplaintAttachment.fromJson).toList();
  }

  Future<ComplaintAttachment> uploadAttachment(String complaintId, List<int> fileBytes, String filename) async {
    final data = await auth.authedUpload(
      '/complaints/$complaintId/attachments',
      fileBytes: fileBytes,
      filename: filename,
      fields: const {},
    );
    return ComplaintAttachment.fromJson(data!);
  }
}
