import 'dart:typed_data';
import '../../core/auth_repository.dart';

class OrderMediaItem {
  final String id;
  final String mediaType;
  final String fileUrl;
  final String? caption;
  final DateTime takenAt;

  OrderMediaItem({
    required this.id,
    required this.mediaType,
    required this.fileUrl,
    required this.caption,
    required this.takenAt,
  });

  factory OrderMediaItem.fromJson(Map<String, dynamic> json) => OrderMediaItem(
        id: json['id'] as String,
        mediaType: json['media_type'] as String,
        fileUrl: json['file_url'] as String,
        caption: json['caption'] as String?,
        takenAt: DateTime.parse(json['taken_at'] as String),
      );
}

class MediaRepository {
  final AuthRepository auth;

  MediaRepository(this.auth);

  // استرجاع صور اترفعت قبل كده — كانت فجوة موثّقة صراحة: لو التطبيق اتقفل وفتح تاني في نص
  // دورة تنفيذ، الفني كان بيشوف زرار "صوّر قبل/بعد الشغل" من غير أي أثر للصور اللي رفعها
  // بالفعل. GET /technician/orders/:id/media كان موجود ومختبر في الباك-إند بلا أي استهلاك هنا.
  Future<List<OrderMediaItem>> listForOrder(String orderId) async {
    final data = await auth.authedRequestList('/technician/orders/$orderId/media');
    return data.map(OrderMediaItem.fromJson).toList();
  }

  Future<Map<String, dynamic>> upload({
    required String orderId,
    required Uint8List fileBytes,
    required String filename,
    required String mediaType,
    String? caption,
  }) async {
    final data = await auth.authedUpload(
      '/technician/orders/$orderId/media',
      fileBytes: fileBytes,
      filename: filename,
      fields: {
        'media_type': mediaType,
        if (caption != null && caption.isNotEmpty) 'caption': caption,
      },
    );
    return data!;
  }
}
