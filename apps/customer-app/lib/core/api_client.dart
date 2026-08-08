import 'dart:convert';
import 'package:http/http.dart' as http;
import 'api_config.dart';
import 'api_exception.dart';

Future<http.Response> _send(
  String method,
  String path, {
  Map<String, dynamic>? body,
  String? accessToken,
}) async {
  final uri = Uri.parse('$apiBaseUrl$path');
  final headers = {
    'Content-Type': 'application/json',
    if (accessToken != null) 'Authorization': 'Bearer $accessToken',
  };

  switch (method) {
    case 'GET':
      return http.get(uri, headers: headers);
    case 'POST':
      return http.post(uri, headers: headers, body: body != null ? jsonEncode(body) : null);
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
}) async {
  final response = await _send(method, path, body: body, accessToken: accessToken);
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
}) async {
  final data = await _apiRequestRaw(method, path, body: body, accessToken: accessToken);
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
