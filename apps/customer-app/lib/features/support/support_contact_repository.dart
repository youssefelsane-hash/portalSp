import '../../core/api_client.dart';

class SupportContact {
  final bool enabled;
  final String? phoneNumber;
  final String? whatsappUrl;
  final String? email;
  final String? helpUrl;

  SupportContact({
    required this.enabled,
    required this.phoneNumber,
    required this.whatsappUrl,
    required this.email,
    required this.helpUrl,
  });

  factory SupportContact.fromJson(Map<String, dynamic> json) => SupportContact(
        enabled: json['enabled'] as bool? ?? false,
        phoneNumber: json['phone_number'] as String?,
        whatsappUrl: json['whatsapp_url'] as String?,
        email: json['email'] as String?,
        helpUrl: json['help_url'] as String?,
      );
}

// GET /settings/support-contact — @Public()، مفيش داعي لـaccessToken (docs/08 §22 بند 15-19).
// التحقق الأمني (أرقام واتساب صحيحة/https فقط) بيحصل في الباك-إند، هنا استهلاك بس.
class SupportContactRepository {
  Future<SupportContact> fetch() async {
    final data = await apiRequest('GET', '/settings/support-contact');
    return SupportContact.fromJson(data!);
  }
}
