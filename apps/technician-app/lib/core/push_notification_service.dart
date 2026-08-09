import 'dart:async';
import 'dart:math';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

// تسجيل جهاز/توكن FCM بعد تسجيل الدخول (`POST /devices` — موجود وشغال في الباك-إند من زمان).
// فشل صامت ومقصود في كل خطوة: لو مفيش google-services.json/GoogleService-Info.plist حقيقيين
// لسه، Firebase.initializeApp() هترمي خطأ منصة (PlatformException) وهنسجّله بس من غير ما نكسر
// تسجيل الدخول أو أي حاجة تانية — نفس مبدأ "فشل خدمة خارجية ميوقفش عملية حقيقية للمستخدم"
// المتّبع في كل مكان تاني في المشروع (راجع CLAUDE.md). تفاصيل الإعداد الكامل المطلوب من مشروع
// Firebase حقيقي: docs/03-external-integrations.md §4.1.
class PushNotificationService {
  static const _deviceIdKey = 'baytak_device_id';
  static const _storage = FlutterSecureStorage();
  static bool _firebaseReady = false;

  // معرّف جهاز ثابت لكل تثبيت (مش توكن FCM نفسه — ده بيتغيّر من وقت للتاني، واستخدامه كمعرّف
  // كان هيعمل صفوف مكررة في user_devices بدل تحديث نفس الصف زي ما الباك-إند متوقّع).
  static Future<String> _getOrCreateDeviceId() async {
    final existing = await _storage.read(key: _deviceIdKey);
    if (existing != null) return existing;
    final random = Random.secure();
    final id = List<int>.generate(16, (_) => random.nextInt(256))
        .map((b) => b.toRadixString(16).padLeft(2, '0'))
        .join();
    await _storage.write(key: _deviceIdKey, value: id);
    return id;
  }

  static Future<void> registerCurrentDevice(
    Future<Map<String, dynamic>?> Function(String method, String path, {Map<String, dynamic>? body}) authedRequest,
  ) async {
    try {
      if (!_firebaseReady) {
        await Firebase.initializeApp();
        _firebaseReady = true;
      }
      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) return;

      final token = await messaging.getToken();
      if (token == null) return;

      final deviceId = await _getOrCreateDeviceId();
      await authedRequest('POST', '/devices', body: {
        'device_id': deviceId,
        'fcm_token': token,
        'platform': defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android',
      });
    } catch (err) {
      debugPrint('[push] فشل تسجيل جهاز إشعارات push (متوقع من غير إعداد Firebase حقيقي): $err');
    }
  }
}
