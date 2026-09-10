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

  /// أي استثناء بيتحوّل لـ`ApiException` مفهومة — نقطة واحدة بدل ما كل شاشة تخمّن.
  ///
  /// **بَقّة حقيقية (بلاغ مالك 2026-09-10: «طلباتي ما بتفتحش، بتفضل بتحمّل»)**: الشاشات كانت
  /// بتمسك `on ApiException catch` بس. الرد رجع سليم من السيرفر، لكن شكل الـenvelope اتغيّر
  /// (`ResponseInterceptor` بيرفع `items` لـ`data` ويحط `meta` جنبها)، فالكاست في الـrepository
  /// رمى `TypeError` — مش `ApiException` — فمحدش مسكه، والـ`setState` اللي بيوقّف التحميل
  /// مانفّذش أبدًا. النتيجة: عجلة تحميل للأبد بلا أي رسالة. الفاكتوري ده بيخلّي أي استثناء
  /// (كاست، تحليل JSON، بَقّة برمجية) ينتهي كرسالة للمستخدم بدل شاشة معلّقة.
  factory ApiException.from(Object error) {
    if (error is ApiException) return error;
    return ApiException(
      code: 'CLIENT_UNEXPECTED',
      message: 'حصل خطأ غير متوقع في التطبيق — حاول تاني',
      statusCode: 0,
    );
  }

  /// نص العرض: الرسالة، ومعاها المعرّف **لو** العطل من عندنا (5xx) — أخطاء التحقق العادية
  /// (4xx) رسالتها مفهومة ومفيش داعي نلوّثها بكود.
  String get displayMessage =>
      statusCode >= 500 && requestId != null ? '$message (كود: $requestId)' : message;

  @override
  String toString() => displayMessage;
}
