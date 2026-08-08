import 'dart:convert';
import 'package:http/http.dart' as http;
import 'api_config.dart';
import 'api_exception.dart';

// نداء عام لأي endpoint في apps/api — بيفكّ الـ envelope (docs/02-data-dictionary.md §13)
// ويرمي ApiException لو success=false. accessToken اختياري (null لمسارات public زي OTP).
Future<Map<String, dynamic>?> apiRequest(
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

  late http.Response response;
  switch (method) {
    case 'GET':
      response = await http.get(uri, headers: headers);
      break;
    case 'POST':
      response = await http.post(uri, headers: headers, body: body != null ? jsonEncode(body) : null);
      break;
    case 'PATCH':
      response = await http.patch(uri, headers: headers, body: body != null ? jsonEncode(body) : null);
      break;
    default:
      throw ArgumentError('HTTP method غير مدعوم: $method');
  }

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
