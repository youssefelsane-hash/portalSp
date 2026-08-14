import 'dart:async';
import 'dart:math';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'deep_link_router.dart';

const _defaultChannelId = 'order_updates';

final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();

// docs/08 §19 بند 11 — كانت فجوة موثّقة صراحة: onMessage/onMessageOpenedApp/getInitialMessage/
// background handler كانوا صفر خالص، يعني (أ) إشعار وصل والتطبيق مفتوح (foreground) كان بيختفي
// من غير أي أثر مرئي — FCM مابيعرضش notification tray تلقائي في foreground، الرسالة كانت بس
// بتوصل لـonMessage stream اللي محدّش كان بيسمعله، و(ب) الضغط على أي إشعار (foreground أو
// background أو cold-start) كان بيفتح التطبيق على الشاشة الافتراضية بلا أي ملاحة لمحتوى
// الإشعار نفسه، رغم إن deep_link موجود في الحمولة من زمان (راجع notification-workflow.service.ts
// بالباك-إند). لازم top-level function (مش closure) + @pragma('vm:entry-point') عشان Android
// يقدر يستدعيها من isolate خلفية منفصلة لما التطبيق مقفول تمامًا.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
  } catch (_) {
    // متوقع لو مفيش إعداد Firebase حقيقي في البيئة دي — نفس فلسفة registerCurrentDevice تحت.
  }
  // مفيش عرض إشعار يدوي هنا عمدًا: رسايل العميل كلها notification-block عادي (مش data-only actionable
  // زي عروض الطلبات للفني)، فنظام التشغيل بيعرضها تلقائيًا في الـtray لما التطبيق في الخلفية/مقفول —
  // الدور هنا بس تسجيل Firebase عشان onBackgroundMessage نفسها تشتغل، مفيش أكتر من كده مطلوب.
}

class PushNotificationService {
  static const _deviceIdKey = 'baytak_device_id';
  static const _storage = FlutterSecureStorage();
  static bool _firebaseReady = false;

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

  static Future<void> _initLocalNotifications() async {
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosInit = DarwinInitializationSettings();
    await _localNotifications.initialize(
      const InitializationSettings(android: androidInit, iOS: iosInit),
      onDidReceiveNotificationResponse: (response) => handleDeepLink(response.payload),
    );

    final androidPlugin =
        _localNotifications.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    await androidPlugin?.requestNotificationsPermission();
    await androidPlugin?.createNotificationChannel(const AndroidNotificationChannel(
      _defaultChannelId,
      'تحديثات الطلبات',
      description: 'إشعارات حالة الطلب، الشات، والتذكيرات',
      importance: Importance.high,
      playSound: true,
    ));
  }

  // FCM مابيعرضش notification tray تلقائي لما التطبيق مفتوح (foreground) — لازم نبنيه يدوي بمكتبة
  // محلية، وإلا الإشعار يوصل بصمت تمامًا (onMessage stream بس، بلا أي أثر مرئي للمستخدم).
  static Future<void> _showForegroundNotification(RemoteMessage message) async {
    final title = message.notification?.title;
    final body = message.notification?.body;
    if (title == null && body == null) return;

    const androidDetails = AndroidNotificationDetails(
      _defaultChannelId,
      'تحديثات الطلبات',
      importance: Importance.high,
      priority: Priority.high,
    );
    const iosDetails = DarwinNotificationDetails();

    await _localNotifications.show(
      message.hashCode,
      title,
      body,
      const NotificationDetails(android: androidDetails, iOS: iosDetails),
      payload: message.data['deep_link'] as String?,
    );
  }

  static Future<void> registerCurrentDevice(
    Future<Map<String, dynamic>?> Function(String method, String path, {Map<String, dynamic>? body}) authedRequest,
  ) async {
    try {
      if (!_firebaseReady) {
        await Firebase.initializeApp();
        _firebaseReady = true;
        await _initLocalNotifications();
        FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
        FirebaseMessaging.onMessage.listen(_showForegroundNotification);
        // التطبيق كان في الخلفية (مش مقفول) والمستخدم ضغط على الإشعار من الـtray.
        FirebaseMessaging.onMessageOpenedApp.listen((message) => handleDeepLink(message.data['deep_link'] as String?));
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

      // التطبيق كان مقفول تمامًا (cold start) والمستخدم فتحه بالضغط على إشعار — لازم يتفحص بعد
      // ما التوكن يتسجّل عشان نضمن التطبيق شغال فعلاً (getInitialMessage بترجع null لو مفيش
      // إشعار سبب الفتح، فمفيش أي أثر جانبي لو المستخدم فتح التطبيق عادي).
      final initialMessage = await messaging.getInitialMessage();
      if (initialMessage != null) {
        handleDeepLink(initialMessage.data['deep_link'] as String?);
      }
    } catch (err) {
      debugPrint('[push] فشل تسجيل جهاز إشعارات push (متوقع من غير إعداد Firebase حقيقي): $err');
    }
  }
}
