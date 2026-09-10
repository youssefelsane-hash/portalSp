import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'api_config.dart';
import 'api_exception.dart';

// الباك-إند بيرفض أي ملف Content-Type مش image/jpeg|png|webp صراحة (TechnicianOrderExecutionController
// ALLOWED_MIME_TYPES) — MultipartFile.fromBytes من غير contentType بيبعت application/octet-stream
// افتراضياً فبيترفض. بنحدده يدوياً من امتداد الملف بدل ما نعتمد على تخمين http package.
MediaType _mediaTypeForFilename(String filename) {
  final lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return MediaType('image', 'png');
  if (lower.endsWith('.webp')) return MediaType('image', 'webp');
  return MediaType('image', 'jpeg');
}

Future<http.Response> _sendRaw(
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

/// كل نداء بيعدّي من هنا عشان المهلة تتطبّق مرة واحدة على كل الأفعال (مفيش نداء بلا مهلة).
Future<http.Response> _sendRequest(
  String method,
  String path, {
  Map<String, dynamic>? body,
  String? accessToken,
}) {
  return _sendRaw(
    method,
    path,
    body: body,
    accessToken: accessToken,
  ).timeout(apiRequestTimeout);
}

/// صفحة من endpoint مُقسّم صفحات (docs/02-data-dictionary.md §13).
///
/// **ليه النوع ده موجود أصلاً**: `ResponseInterceptor` في الباك-إند بيفكّ أي رد شكله
/// `{items, meta}` ويحط `items` في `data` و`meta` **جنب** `data` في الـenvelope — يعني الرد
/// النهائي `{success, data: [...], meta: {...}}`، مش `{data: {items, meta}}`. الكود اللي
/// بيقرا `data['items']` بيلاقي `data` قايمة مش Map، فالكاست بيرمي `TypeError` والشاشة تعلّق.
/// (ده بالظبط اللي حصل في «طلباتي» بعد ما الطلبات بقت cursor-paginated، ونفس الحاجة اتصلحت
/// قبل كده في الإشعارات كإصلاح موضعي.) النوع ده + `apiRequestPage()` بيخلّوا العقد الصح
/// مكتوب في مكان واحد بدل ما كل repository يخمّنه.
class ApiPage {
  final List<Map<String, dynamic>> items;
  final Map<String, dynamic> meta;

  const ApiPage({required this.items, required this.meta});

  String? get nextCursor => meta['next_cursor'] as String?;
  bool get hasMore => meta['has_more'] as bool? ?? (nextCursor != null);
}

/// المهلة القصوى لأي نداء API.
///
/// من غيرها، سوكيت اتعلّق (شبكة موبايل بتتنقل بين أبراج، بروكسي بيبلع الرد) بيخلّي
/// `http.get()` مستني **للأبد** — والشاشة تفضل على عجلة تحميل بلا رسالة ولا طريقة خروج.
/// `http` مالوش مهلة افتراضية خالص، فلازم تتحدد صراحة.
const Duration apiRequestTimeout = Duration(seconds: 30);

// بَقّة حقيقية اتلقطت (المالك بلّغ 2026-08-19) — كل شاشة بتمسك `on ApiException catch` بس.
// أي فشل تاني (انقطاع الشبكة، CORS على الويب، timeout، رد مش JSON صالح) كان بيرمي استثناء
// محدّش بيمسكه، فالشاشة تفضل عالقة على loading spinner للأبد. الإصلاح: أي استثناء غير
// `ApiException` بيتحوّل هنا لـ`ApiException` واضح — نقطة واحدة بدل تعديل كل شاشة لوحدها.
Future<T> _guardNetworkError<T>(Future<T> Function() action) async {
  try {
    return await action();
  } on ApiException {
    rethrow;
  } catch (err) {
    throw ApiException(
      code: 'NETWORK_ERROR',
      message: 'تعذر الاتصال بالخادم — تأكد من اتصالك بالإنترنت وحاول تاني',
      statusCode: 0,
    );
  }
}

/// الـenvelope كامل بعد التحقق من `success` — `data` و`meta` مع بعض.
///
/// بيرمي `ApiException` لو الرد مش JSON صالح أصلاً بدل ما يرمي `FormatException` خام: الرد
/// المش-JSON (صفحة 502 من proxy، صفحة HTML من captive portal) حالة حقيقية في الشبكات
/// المحمولة، ولازم توصل للمستخدم كرسالة مش كشاشة معلّقة.
Future<({dynamic data, Map<String, dynamic> meta})> _apiRequestEnvelope(
  String method,
  String path, {
  Map<String, dynamic>? body,
  String? accessToken,
}) async {
  return _guardNetworkError(() async {
    final response = await _sendRequest(
      method,
      path,
      body: body,
      accessToken: accessToken,
      );
    final Object? parsed;
    try {
      parsed = jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
      throw ApiException(
        code: 'BAD_RESPONSE',
        message: 'رد السيرفر غير مفهوم — حاول تاني',
        statusCode: response.statusCode,
      );
    }
    if (parsed is! Map<String, dynamic>) {
      throw ApiException(
        code: 'BAD_RESPONSE',
        message: 'رد السيرفر غير مفهوم — حاول تاني',
        statusCode: response.statusCode,
      );
    }
    final decoded = parsed;
    final success = decoded['success'] as bool? ?? false;

    if (!success) {
      final error = decoded['error'] as Map<String, dynamic>?;
      throw ApiException(
        code: error?['code'] as String? ?? 'UNKNOWN',
        message: error?['message'] as String? ?? 'حصل خطأ غير متوقع',
        statusCode: response.statusCode,
        requestId: decoded['request_id'] as String?,
      );
    }

    return (data: decoded['data'], meta: decoded['meta'] as Map<String, dynamic>? ?? const {});
  });
}

// بيفكّ الـ envelope (docs/02-data-dictionary.md §13) ويرمي ApiException لو success=false،
// ويرجّع data الخام (Map/List/primitive حسب الـ endpoint) — الكولر مسؤول عن الـ cast المناسب.
Future<dynamic> _apiRequestRaw(
  String method,
  String path, {
  Map<String, dynamic>? body,
  String? accessToken,
}) async {
  final envelope = await _apiRequestEnvelope(
    method,
    path,
    body: body,
    accessToken: accessToken,
  );
  return envelope.data;
}

/// خطأ «الشكل اللي رجع مش اللي متوقّع» — بيتعرض للمستخدم كرسالة، مش بيعلّق الشاشة.
ApiException _unexpectedShape(String path, String expected, Object? got) {
  // السبب الحقيقي لازم يوصل للمطوّر، والرسالة العامة بس هي اللي توصل للمستخدم.
  debugPrint('عقد الرد اتغيّر على $path — المتوقّع $expected، اللي رجع ${got.runtimeType}');
  return ApiException(
    code: 'BAD_RESPONSE',
    message: 'رد السيرفر غير متوقع — حاول تاني',
    statusCode: 0,
  );
}

// نداء عام لـ endpoints بترجع object واحد. accessToken اختياري (null لمسارات public زي OTP/الكتالوج).
Future<Map<String, dynamic>?> apiRequest(
  String method,
  String path, {
  Map<String, dynamic>? body,
  String? accessToken,
}) async {
  final data = await _apiRequestRaw(
    method,
    path,
    body: body,
    accessToken: accessToken,
  );
  if (data == null) return null;
  if (data is! Map<String, dynamic>) throw _unexpectedShape(path, 'object', data);
  return data;
}

// نداء عام لـ endpoints بترجع قايمة (زي /service-categories، /services) — مش envelope مُقسّم
// صفحات {items, meta} هنا، القايمة بترجع كاملة في data مباشرة.
Future<List<Map<String, dynamic>>> apiRequestList(
  String path, {
  String? accessToken,
}) async {
  final data = await _apiRequestRaw('GET', path, accessToken: accessToken);
  if (data is! List<dynamic>) throw _unexpectedShape(path, 'list', data);
  return data.cast<Map<String, dynamic>>();
}

/// نداء لـ endpoint مُقسّم صفحات — بيرجّع العناصر و`meta` (اللي فيها `next_cursor`) مع بعض.
///
/// لازم يتستخدم لأي endpoint الكونترولر بيرجّع منه `{items, meta}`؛ `apiRequest()` هيرمي
/// `BAD_RESPONSE` معاه لأن `data` بتبقى قايمة مش Map.
Future<ApiPage> apiRequestPage(
  String path, {
  String? accessToken,
}) async {
  final envelope = await _apiRequestEnvelope('GET', path, accessToken: accessToken);
  final data = envelope.data;
  if (data is! List<dynamic>) throw _unexpectedShape(path, 'page', data);
  return ApiPage(items: data.cast<Map<String, dynamic>>(), meta: envelope.meta);
}

// رفع ملف (multipart/form-data) — مستقل عن apiRequest عادي لأن الـ body مش JSON هنا.
// مطابق لعقد POST /technician/orders/:id/media (حقل 'file' + fields زي 'media_type'/'caption').
Future<Map<String, dynamic>?> apiUpload(
  String path, {
  required List<int> fileBytes,
  required String filename,
  required Map<String, String> fields,
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
  return _guardNetworkError(() async {
    final streamedResponse = await request.send().timeout(apiRequestTimeout);
    final response = await http.Response.fromStream(streamedResponse);
    final decoded = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    final success = decoded['success'] as bool? ?? false;

    if (!success) {
      final error = decoded['error'] as Map<String, dynamic>?;
      throw ApiException(
        code: error?['code'] as String? ?? 'UNKNOWN',
        message: error?['message'] as String? ?? 'حصل خطأ غير متوقع',
        statusCode: response.statusCode,
        requestId: decoded['request_id'] as String?,
      );
    }

    return decoded['data'] as Map<String, dynamic>?;
  });
}
