import 'dart:typed_data';

import '../../core/auth_repository.dart';
import 'models.dart';

// اعتماد الفني الجديد (docs/02 §technician_profiles) — كانت فجوة موثّقة صراحة: GET /technician/me
// وPOST/GET /technician/documents مختبرين حي في الباك-إند بلا أي شاشة في apps/technician-app
// بتناديهم — الفني الجديد كان بيسجّل دخول وبعدين يلاقي نفسه في AvailableOrdersScreen فاضية
// للأبد من غير أي تفسير (matching.service.ts بيرفض أي فني verification_status != approved).
class OnboardingRepository {
  final AuthRepository auth;

  OnboardingRepository(this.auth);

  Future<TechnicianMe> fetchMe() async {
    final data = await auth.authedRequest('GET', '/technician/me');
    return TechnicianMe.fromJson(data!);
  }

  Future<List<TechnicianDocument>> listDocuments() async {
    final items = await auth.authedRequestList('/technician/documents');
    return items.map(TechnicianDocument.fromJson).toList();
  }

  Future<TechnicianDocument> uploadDocument({
    required String documentType,
    required Uint8List fileBytes,
    required String filename,
    String? expiresAt,
  }) async {
    final data = await auth.authedUpload(
      '/technician/documents',
      fileBytes: fileBytes,
      filename: filename,
      fields: {
        'document_type': documentType,
        if (expiresAt != null && expiresAt.isNotEmpty) 'expires_at': expiresAt,
      },
    );
    return TechnicianDocument.fromJson(data!);
  }
}
