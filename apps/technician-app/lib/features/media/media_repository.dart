import 'dart:typed_data';
import '../../core/auth_repository.dart';

class MediaRepository {
  final AuthRepository auth;

  MediaRepository(this.auth);

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
