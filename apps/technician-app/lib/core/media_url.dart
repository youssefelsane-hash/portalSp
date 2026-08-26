import 'api_config.dart';

String resolveMediaUrl(String fileUrl) {
  final value = fileUrl.trim();
  final uri = Uri.tryParse(value);
  final origin = apiBaseUrl.replaceFirst(RegExp(r'/api/v1/?$'), '');
  if (uri != null && (uri.scheme == 'http' || uri.scheme == 'https')) {
    if (uri.path.startsWith('/uploads/')) {
      final suffix = uri.hasQuery ? '${uri.path}?${uri.query}' : uri.path;
      return '$origin$suffix';
    }
    return value;
  }
  return '$origin${value.startsWith('/') ? '' : '/'}$value';
}
