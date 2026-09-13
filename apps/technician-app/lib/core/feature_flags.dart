import 'dart:async';

import 'package:flutter/foundation.dart';

import 'auth_repository.dart';

/// Snapshot للفلاجز بعد تسجيل الدخول. الفشل لا يعطّل الفني؛ نرجع للسلوك الأساسي الآمن.
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

  bool isEnabled(String key, {required bool fallback}) =>
      _values[key] ?? fallback;

  Future<void> _load(AuthRepository auth, String userId) async {
    try {
      final response = await auth.authedRequest('GET', '/feature-flags/me');
      if (_loadedUserId != userId) return;
      final items = response?['items'] as List<dynamic>? ?? const <dynamic>[];
      _values = {
        for (final item in items.whereType<Map<String, dynamic>>())
          if (item['key'] is String && item['enabled'] is bool)
            item['key'] as String: item['enabled'] as bool,
      };
      notifyListeners();
    } catch (_) {
      // feature flags لا تمنع تطبيق الفني من العمل لو حصل عطل مؤقت.
    }
  }
}
