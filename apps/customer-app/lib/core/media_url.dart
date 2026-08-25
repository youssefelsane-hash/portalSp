import 'api_config.dart';

String resolveMediaUrl(String fileUrl) {
  final value = fileUrl.trim();
  final uri = Uri.tryParse(value);
  if (uri != null && (uri.scheme == 'http' || uri.scheme == 'https')) return value;
  final origin = apiBaseUrl.replaceFirst(RegExp(r'/api/v1/?$'), '');
  return '$origin${value.startsWith('/') ? '' : '/'}$value';
}
