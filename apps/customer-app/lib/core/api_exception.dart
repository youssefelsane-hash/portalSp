// مطابق لـ ApiErrorBody في apps/api/src/common/dto/api-response.ts
class ApiException implements Exception {
  final String code;
  final String message;
  final int statusCode;

  /// معرّف الطلب من رد السيرفر (`request_id`) — بيتعرض مع أخطاء الـ500 بس.
  ///
  /// **ليه موجود**: بلاغ مالك — «بيظهر خطأ غير متوقع… والتيرمنال مش ظاهر فيها الـerror».
  /// «حصل خطأ غير متوقع» رسالة عامة مالهاش أي أثر يوصّل لسببها في لوج فيه آلاف السطور.
  /// نفس المعرّف ده بيتطبع في أول سطر الـ500 في الباك-إند، فـ`grep <id>` بيوصل للسبب فورًا.
  final String? requestId;

  ApiException({
    required this.code,
    required this.message,
    required this.statusCode,
    this.requestId,
  });

  /// نص العرض: الرسالة، ومعاها المعرّف **لو** العطل من عندنا (5xx) — أخطاء التحقق العادية
  /// (4xx) رسالتها مفهومة ومفيش داعي نلوّثها بكود.
  String get displayMessage =>
      statusCode >= 500 && requestId != null ? '$message (كود: $requestId)' : message;

  @override
  String toString() => displayMessage;
}
