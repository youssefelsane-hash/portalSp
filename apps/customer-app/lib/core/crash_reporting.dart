import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// نقطة مركزية لتقارير أعطال تطبيق العميل.
///
/// لا تُرسل أجسام الطلبات أو أرقام الهواتف أو رموز الدخول. التقارير تقتصر على اسم الشاشة،
/// مسار الـAPI، كود الحالة، ومعرّف الطلب؛ وCrashlytics يضيف نوع الجهاز ووقت العطل تلقائيًا.
class CrashReporting {
  CrashReporting._();

  static bool _ready = false;
  static bool get isReady => _ready;

  static Future<void> initialize() async {
    try {
      if (Firebase.apps.isEmpty) await Firebase.initializeApp();
      await FirebaseCrashlytics.instance.setCrashlyticsCollectionEnabled(
        !kDebugMode,
      );
      _ready = true;

      FlutterError.onError = (details) {
        FlutterError.presentError(details);
        unawaited(
          FirebaseCrashlytics.instance.recordFlutterFatalError(details),
        );
      };
      PlatformDispatcher.instance.onError = (error, stack) {
        unawaited(recordError(error, stack, fatal: true));
        return true;
      };
    } catch (error) {
      // المراقبة خدمة مساندة: تعطل إعداد Firebase لا يجوز أن يمنع العميل من فتح التطبيق.
      debugPrint('[monitoring] Crashlytics غير متاح: $error');
    }
  }

  static Future<void> recordError(
    Object error,
    StackTrace stack, {
    bool fatal = false,
    String? reason,
  }) async {
    if (!_ready) {
      debugPrint('[monitoring] ${reason ?? 'unhandled'}: $error');
      return;
    }
    await FirebaseCrashlytics.instance.recordError(
      error,
      stack,
      fatal: fatal,
      reason: reason,
    );
  }

  static Future<void> recordApiFailure({
    required String method,
    required String path,
    required Object error,
    required StackTrace stack,
    int? statusCode,
    String? errorCode,
    String? requestId,
  }) async {
    if (!_ready) return;
    final crashlytics = FirebaseCrashlytics.instance;
    await crashlytics.setCustomKey('api_method', method);
    await crashlytics.setCustomKey('api_path', path);
    await crashlytics.setCustomKey('api_status', statusCode ?? 0);
    await crashlytics.setCustomKey('api_error_code', errorCode ?? 'unknown');
    await crashlytics.setCustomKey('api_request_id', requestId ?? 'none');
    await crashlytics.recordError(error, stack, reason: 'API request failed');
  }

  static Future<void> setCurrentScreen(String screen) async {
    if (!_ready) return;
    await FirebaseCrashlytics.instance.setCustomKey('current_screen', screen);
    await FirebaseCrashlytics.instance.log('screen:$screen');
  }
}

class CrashReportingNavigatorObserver extends NavigatorObserver {
  void _record(Route<dynamic>? route) {
    if (route == null) return;
    final name = route.settings.name ?? route.runtimeType.toString();
    unawaited(CrashReporting.setCurrentScreen(name));
  }

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) =>
      _record(route);

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) =>
      _record(previousRoute);

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) =>
      _record(newRoute);
}
