import 'dart:async';

import 'package:flutter/foundation.dart';

import 'auth_repository.dart';

/// Snapshot للفلاجز بعد تسجيل الدخول. أي فشل شبكة يترك الشاشة على سلوكها الأساسي؛ الفلاج
/// أداة إطلاق/إيقاف تدريجي وليس سببًا يمنع العميل من استخدام التطبيق.
class FeatureFlags extends ChangeNotifier {
  String? _loadedUserId;
  Map<String, bool> _values = const {};

  void attach(AuthRepository auth) {
    final userId = auth.user?.id;
    if (!auth.isAuthenticated || userId == null) {
      if (_loadedUserId != null || _values.isNotEmpty) {
        _loadedUserId = null;
        _values = const {};
        notifyListeners();
      }
      return;
    }
    if (_loadedUserId == userId) return;
    _loadedUserId = userId;
    _values = const {};
    unawaited(_load(auth, userId));
  }

  /// الفلاج غير المنشأ = السلوك الحالي؛ ده يمنع إضافة طبقة flags من كسر ميزة قائمة بالخطأ.
  bool isEnabled(String key, {required bool fallback}) =>
      _values[key] ?? fallback;

  Future<void> _load(AuthRepository auth, String userId) async {
    try {
      final response = await auth.authedRequest('GET', '/feature-flags/me');
      if (_loadedUserId != userId) return;
      final items = (response?['items'] as List<dynamic>? ?? const <dynamic>[]);
      _values = {
        for (final item in items.whereType<Map<String, dynamic>>())
          if (item['key'] is String && item['enabled'] is bool)
            item['key'] as String: item['enabled'] as bool,
      };
      notifyListeners();
    } catch (_) {
      // التطبيق يفضل usable حتى لو خدمة الفلاجز أو الشبكة غير متاحة مؤقتًا.
    }
  }
}
