import '../../core/auth_repository.dart';
import 'models.dart';

// شكاوى العميل (docs/08 §19 بند 13) — كانت فجوة موثّقة صراحة: الباك-إند وتذاكر الدعم (complaints
// module) وAdmin UI كانوا موجودين ومختبرين حيًا من زمان، بس customer-app ملهاش أي شاشة بتستخدمهم
// خالص (مختلف عن شات الدعم العام lib/features/chat — ده thread محادثة حرة، مش نظام تذاكر بحالة/
// SLA/قرار). تفاصيل الباك-إند الكاملة في apps/api/src/modules/support/README.md.
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
    final data = await auth.authedUpload('/complaints/$complaintId/attachments', fileBytes: fileBytes, filename: filename);
    return ComplaintAttachment.fromJson(data!);
  }
}
