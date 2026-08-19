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

  // زرار أونلاين/أوفلاين (Script 4 §8) — كان مبني بالكامل في الباك-إند من زمان
  // (PATCH /technician/availability) بس مفيش شاشة كانت بتناديه. بيبدّل is_available وis_on_duty
  // مع بعض دايمًا (راجع تعليق TechnicianMe.isOnDuty).
  Future<TechnicianMe> setOnDuty(bool onDuty) async {
    final data = await auth.authedRequest(
      'PATCH',
      '/technician/availability',
      body: {'is_available': onDuty, 'is_on_duty': onDuty},
    );
    return TechnicianMe.fromJson(data!);
  }

  // "معاه مساعد؟" (docs/06 §3.7) — الفني بيحدد المساعد بنفسه بكوده (technician_code)، الإدارة
  // بعد كده توافق/ترفض من apps/admin. مفيش auto-matching (فجوة موثّقة صراحة في technicians/README.md).
  Future<Map<String, dynamic>> requestAssistant(
    String assistantTechnicianCode,
  ) async {
    final data = await auth.authedRequest(
      'POST',
      '/technician/assistant-request',
      body: {'assistant_technician_code': assistantTechnicianCode},
    );
    return data!;
  }

  // إزالة الربط ذاتية (مفيش داعي موافقة إدارة) — بتشتغل سواء كان الطلب pending_approval أو approved.
  Future<Map<String, dynamic>> removeAssistant() async {
    final data = await auth.authedRequest('DELETE', '/technician/assistant');
    return data!;
  }

  // بَقّة حقيقية اتلقطت (بلاغ المالك — سيناريو "يوسف"): current_location مالوش أي مسار شرعي
  // يتحدد بيه أول مرة قبل ما الفني ياخد طلب فعلي — POST /technician/location كان موجود
  // بالباك-إند من زمان بلا أي نداء ليه من التطبيق خالص (المسار الوحيد المتصل فعليًا كان
  // WebSocket تتبّع الموقع، ومتاح بس وقت طلب نشط). بيتنادى دلوقتي مرة واحدة أول ما
  // AvailableOrdersScreen تفتح (`_captureInitialLocation`) عشان matching.service.ts's شرط
  // current_location IS NOT NULL يتحقق من أول لحظة، مش بعد أول طلب.
  Future<void> updateLocation(double latitude, double longitude) async {
    await auth.authedRequest('POST', '/technician/location', body: {'latitude': latitude, 'longitude': longitude});
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
