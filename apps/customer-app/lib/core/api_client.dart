import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'api_config.dart';
import 'api_exception.dart';

// الباك-إند بيرفض أي ملف Content-Type مش image/jpeg|png|webp صراحة — MultipartFile.fromBytes
// من غير contentType بيبعت application/octet-stream افتراضياً فبيترفض. بنحدده يدوياً من امتداد
// الملف بدل ما نعتمد على تخمين http package (نفس نمط apps/technician-app/lib/core/api_client.dart).
MediaType _mediaTypeForFilename(String filename) {
  final lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return MediaType('image', 'png');
  if (lower.endsWith('.webp')) return MediaType('image', 'webp');
  return MediaType('image', 'jpeg');
}

Future<http.Response> _send(
  String method,
  String path, {
  Map<String, dynamic>? body,
  String? accessToken,
  Map<String, String>? extraHeaders,
}) async {
  final uri = Uri.parse('$apiBaseUrl$path');
  final headers = {
    'Content-Type': 'application/json',
    if (accessToken != null) 'Authorization': 'Bearer $accessToken',
    if (extraHeaders != null) ...extraHeaders,
  };

  switch (method) {
    case 'GET':
      return http.get(uri, headers: headers);
    case 'POST':
      return http.post(uri, headers: headers, body: body != null ? jsonEncode(body) : null);
    case 'PUT':
      return http.put(uri, headers: headers, body: body != null ? jsonEncode(body) : null);
    case 'PATCH':
      return http.patch(uri, headers: headers, body: body != null ? jsonEncode(body) : null);
    case 'DELETE':
      return http.delete(uri, headers: headers, body: body != null ? jsonEncode(body) : null);
    default:
      throw ArgumentError('HTTP method غير مدعوم: $method');
  }
}

// بيفكّ الـ envelope (docs/02-data-dictionary.md §13) ويرمي ApiException لو success=false،
// ويرجّع data الخام (Map/List/primitive حسب الـ endpoint) — الكولر مسؤول عن الـ cast المناسب.
Future<dynamic> _apiRequestRaw(
  String method,
  String path, {
  Map<String, dynamic>? body,
  String? accessToken,
  Map<String, String>? extraHeaders,
}) async {
  final response = await _send(method, path, body: body, accessToken: accessToken, extraHeaders: extraHeaders);
  final decoded = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
  final success = decoded['success'] as bool? ?? false;

  if (!success) {
    final error = decoded['error'] as Map<String, dynamic>?;
    throw ApiException(
      code: error?['code'] as String? ?? 'UNKNOWN',
      message: error?['message'] as String? ?? 'حصل خطأ غير متوقع',
      statusCode: response.statusCode,
    );
  }

  return decoded['data'];
}

// نداء عام لـ endpoints بترجع object واحد. accessToken اختياري (null لمسارات public زي OTP/الكتالوج).
Future<Map<String, dynamic>?> apiRequest(
  String method,
  String path, {
  Map<String, dynamic>? body,
  String? accessToken,
  Map<String, String>? extraHeaders,
}) async {
  final data = await _apiRequestRaw(method, path, body: body, accessToken: accessToken, extraHeaders: extraHeaders);
  return data as Map<String, dynamic>?;
}

// نداء عام لـ endpoints بترجع قايمة (زي /service-categories، /services) — مش envelope مُقسّم
// صفحات {items, meta} هنا، القايمة بترجع كاملة في data مباشرة.
Future<List<Map<String, dynamic>>> apiRequestList(
  String path, {
  String? accessToken,
}) async {
  final data = await _apiRequestRaw('GET', path, accessToken: accessToken);
  return (data as List<dynamic>).cast<Map<String, dynamic>>();
}

// رفع ملف (multipart/form-data) — مستقل عن apiRequest عادي لأن الـ body مش JSON هنا.
// مطابق لعقد POST /chat/threads/:id/messages/image (حقل 'file' بس، مفيش fields إضافية).
Future<Map<String, dynamic>?> apiUpload(
  String path, {
  required List<int> fileBytes,
  required String filename,
  Map<String, String> fields = const {},
  String? accessToken,
}) async {
  final uri = Uri.parse('$apiBaseUrl$path');
  final request = http.MultipartRequest('POST', uri)
    ..fields.addAll(fields)
    ..files.add(http.MultipartFile.fromBytes(
      'file',
      fileBytes,
      filename: filename,
      contentType: _mediaTypeForFilename(filename),
    ));
  if (accessToken != null) {
    request.headers['Authorization'] = 'Bearer $accessToken';
  }
  final streamedResponse = await request.send();
  final response = await http.Response.fromStream(streamedResponse);
  final decoded = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
  final success = decoded['success'] as bool? ?? false;

  if (!success) {
    final error = decoded['error'] as Map<String, dynamic>?;
    throw ApiException(
      code: error?['code'] as String? ?? 'UNKNOWN',
      message: error?['message'] as String? ?? 'حصل خطأ غير متوقع',
      statusCode: response.statusCode,
    );
  }

  return decoded['data'] as Map<String, dynamic>?;
}
