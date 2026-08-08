// مطابق لـ ApiErrorBody في apps/api/src/common/dto/api-response.ts
class ApiException implements Exception {
  final String code;
  final String message;
  final int statusCode;

  ApiException({required this.code, required this.message, required this.statusCode});

  @override
  String toString() => message;
}
