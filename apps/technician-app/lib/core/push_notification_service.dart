import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api_client.dart';

// نفس المفتاح بالحرف المستخدم في auth_repository.dart — لازم يتطابق عشان الفعل من زرار الإشعار
// (اللي بيشتغل من isolate خلفية منفصلة تمامًا، بلا أي وصول لحالة AuthRepository في الذاكرة) يقدر
// يقرا نفس الجلسة المحفوظة.
const _refreshTokenKey = 'baytak_refresh_token';
const _secureStorage = FlutterSecureStorage();

const _criticalOfferChannelId = 'critical_offer';
const _actionRequiredChannelId = 'action_required';

final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();

// docs/08 §17.16 — إشعارات عرض الطلب actionable بتوصل data-only (بلا notification block،
// راجع FcmPushDispatcher.buildMessage في الباك-إند) عشان نقدر نبني إشعار محلي بأزرار قبول/رفض
// حقيقية. لازم top-level function (مش closure ولا method) + @pragma('vm:entry-point') عشان
// Android يقدر يستدعيها من isolate خلفية منفصلة لما التطبيق مقفول تمامًا.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
  } catch (_) {
    // متوقع لو مفيش إعداد Firebase حقيقي في البيئة دي — نفس فلسفة registerCurrentDevice تحت.
  }
  await _showActionableNotificationIfNeeded(message);
}

@pragma('vm:entry-point')
void onBackgroundNotificationResponse(NotificationResponse response) {
  _handleNotificationAction(response);
}

/// تسجيل جهاز/توكن FCM بعد تسجيل الدخول (`POST /devices` — موجود وشغال في الباك-إند من زمان)
/// + استقبال/عرض إشعارات عرض الطلب actionable (docs/08 §17.16، عادي وطوارئ).
/// فشل صامت ومقصود في كل خطوة: لو مفيش google-services.json/GoogleService-Info.plist حقيقيين
/// لسه، Firebase.initializeApp() هترمي خطأ منصة (PlatformException) وهنسجّله بس من غير ما نكسر
/// تسجيل الدخول أو أي حاجة تانية — نفس مبدأ "فشل خدمة خارجية ميوقفش عملية حقيقية للمستخدم"
/// المتّبع في كل مكان تاني في المشروع (راجع CLAUDE.md). تفاصيل الإعداد الكامل المطلوب من مشروع
/// Firebase حقيقي: docs/03-external-integrations.md §4.1.
///
/// **حالة الاختبار (docs/08 §17.16)**: التسجيل/الحساب/الاستدعاءات هنا كلها كود حقيقي شغال —
/// مفيش جهاز/إعداد Firebase حقيقي متاح في بيئة التطوير دي عشان نتحقق من السلوك الفعلي على
/// الهاردوير (heads-up notification حقيقي، أزرار قابلة للمس فعليًا، اهتزاز). التصنيف:
/// `IMPLEMENTED — DEVICE TEST PENDING` (نفس تصنيف بصمة apps/customer-app في نفس الوثيقة).
class PushNotificationService {
  static const _deviceIdKey = 'baytak_device_id';
  static bool _firebaseReady = false;

  // معرّف جهاز ثابت لكل تثبيت (مش توكن FCM نفسه — ده بيتغيّر من وقت للتاني، واستخدامه كمعرّف
  // كان هيعمل صفوف مكررة في user_devices بدل تحديث نفس الصف زي ما الباك-إند متوقّع).
  static Future<String> _getOrCreateDeviceId() async {
    final existing = await _secureStorage.read(key: _deviceIdKey);
    if (existing != null) return existing;
    final random = Random.secure();
    final id = List<int>.generate(16, (_) => random.nextInt(256))
        .map((b) => b.toRadixString(16).padLeft(2, '0'))
        .join();
    await _secureStorage.write(key: _deviceIdKey, value: id);
    return id;
  }

  static Future<void> _initLocalNotifications() async {
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosInit = DarwinInitializationSettings();
    await _localNotifications.initialize(
      const InitializationSettings(android: androidInit, iOS: iosInit),
      onDidReceiveNotificationResponse: _handleNotificationAction,
      onDidReceiveBackgroundNotificationResponse: onBackgroundNotificationResponse,
    );

    final androidPlugin =
        _localNotifications.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    // Android 13+ محتاج طلب صلاحية runtime صريح — إعلانها في AndroidManifest.xml بس مش كفاية.
    await androidPlugin?.requestNotificationsPermission();
    // قناتين منفصلتين — الطوارئ بأولوية/صوت مختلف عمدًا عشان الفني يميّزها فورًا من غير ما يفتح
    // الإشعار (docs/08 §17.16: "صوت طوارئ فريد قابل للتهيئة، اهتزاز قوي").
    await androidPlugin?.createNotificationChannel(const AndroidNotificationChannel(
      _criticalOfferChannelId,
      'عروض الطوارئ',
      description: 'إشعارات عروض الطلبات الطارئة — قبول/رفض سريع',
      importance: Importance.max,
      playSound: true,
      enableVibration: true,
    ));
    await androidPlugin?.createNotificationChannel(const AndroidNotificationChannel(
      _actionRequiredChannelId,
      'عروض الطلبات',
      description: 'إشعارات عروض الطلبات العادية',
      importance: Importance.high,
      playSound: true,
    ));
  }

  static Future<void> registerCurrentDevice(
    Future<Map<String, dynamic>?> Function(String method, String path, {Map<String, dynamic>? body}) authedRequest,
  ) async {
    try {
      if (!_firebaseReady) {
        await Firebase.initializeApp();
        _firebaseReady = true;
        await _initLocalNotifications();
        // لازم تتسجّل بعد Firebase.initializeApp() مباشرة — مش شرط قبل runApp() حرفيًا، بس محتاجة
        // تكون مسجّلة قبل أي رسالة توصل فعليًا. بما إن التسجيل هنا بيحصل أول ما الفني يسجّل دخول
        // (ولازم يكون مسجّل دخول أصلاً عشان يستقبل عروض طلبات)، ده كافي عمليًا.
        FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
        FirebaseMessaging.onMessage.listen(_showActionableNotificationIfNeeded);
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

/// docs/08 §17.16 — بيبني إشعار محلي بأزرار قبول/رفض حقيقية من حمولة FCM data-only. إشعارات
/// عادية (informational مثلاً) بتوصل بـnotification block قياسي وبتتعامل تلقائيًا من نظام
/// التشغيل، مفيش داعي نبنيها يدوي هنا (actionable=false بترجع فورًا).
Future<void> _showActionableNotificationIfNeeded(RemoteMessage message) async {
  final data = message.data;
  if (data['actionable'] != 'true') return;

  final title = (data['title'] as String?) ?? message.notification?.title ?? '';
  final body = (data['body'] as String?) ?? message.notification?.body ?? '';
  if (title.isEmpty && body.isEmpty) return;

  final priorityTier = data['priority_tier'] as String?;
  final isCritical = priorityTier == 'critical_offer';
  final channelId = isCritical ? _criticalOfferChannelId : _actionRequiredChannelId;

  Map<String, dynamic> actionLabels = const {};
  final rawActionLabels = data['action_labels'] as String?;
  if (rawActionLabels != null) {
    try {
      actionLabels = jsonDecode(rawActionLabels) as Map<String, dynamic>;
    } catch (_) {
      // حمولة أزرار فاسدة — بنعرض الإشعار بلا أزرار بدل ما نفشل السطر كله (safe degrade).
    }
  }

  final androidDetails = AndroidNotificationDetails(
    channelId,
    isCritical ? 'عروض الطوارئ' : 'عروض الطلبات',
    importance: isCritical ? Importance.max : Importance.high,
    priority: isCritical ? Priority.max : Priority.high,
    category: AndroidNotificationCategory.call,
    fullScreenIntent: isCritical,
    actions: [
      if (actionLabels['accept'] is String) AndroidNotificationAction('accept', actionLabels['accept'] as String),
      if (actionLabels['reject'] is String) AndroidNotificationAction('reject', actionLabels['reject'] as String),
    ],
  );
  const iosDetails = DarwinNotificationDetails(categoryIdentifier: 'ORDER_OFFER_ACTIONS');

  await _localNotifications.show(
    // hashCode بس ضامن id مختلف تقريبًا لكل رسالة — مفيش معرّف رقمي ثابت في data نفسها.
    message.hashCode,
    title,
    body,
    NotificationDetails(android: androidDetails, iOS: iosDetails),
    payload: jsonEncode(data),
  );
}

/// تاب على زرار قبول/رفض جوّه الإشعار نفسه — بتشتغل حتى لو التطبيق مقفول تمامًا (background
/// isolate منفصل، بلا أي حالة AuthRepository في الذاكرة)، فمحتاجة تعيد بناء جلسة مصادقة من
/// الصفر عبر refresh_token المحفوظ في flutter_secure_storage. مجرد تاب على جسم الإشعار (مش
/// زرار) بيترك من غير فعل — deep_link موجود جوّه الـpayload لو حبينا نضيف navigation فعلي لاحقًا.
void _handleNotificationAction(NotificationResponse response) {
  final actionId = response.actionId;
  if (actionId != 'accept' && actionId != 'reject') return;

  final payload = response.payload;
  if (payload == null) return;

  Map<String, dynamic> data;
  try {
    data = jsonDecode(payload) as Map<String, dynamic>;
  } catch (_) {
    return;
  }

  // orderId مدموج في الـpath عمدًا (راجع order-offer-notification.listener.ts في الباك-إند) —
  // accept()/reject() في MatchingService بياخدوا orderId، مش assignmentId.
  final deepLink = data['deep_link'] as String?;
  if (deepLink == null) return;
  final segments = deepLink.split('/').where((s) => s.isNotEmpty).toList();
  if (segments.isEmpty) return;
  final orderId = segments.last;

  unawaited(_performOfferAction(orderId, actionId!));
}

Future<void> _performOfferAction(String orderId, String action) async {
  try {
    final refreshToken = await _secureStorage.read(key: _refreshTokenKey);
    if (refreshToken == null) return; // مفيش جلسة محفوظة — مينفعش نتصرف نيابة عن حد مسجّلش دخول

    final refreshData = await apiRequest('POST', '/auth/refresh', body: {'refresh_token': refreshToken});
    final newAccessToken = refreshData?['access_token'] as String?;
    if (newAccessToken == null) return;
    final newRefreshToken = refreshData?['refresh_token'] as String?;
    if (newRefreshToken != null) {
      await _secureStorage.write(key: _refreshTokenKey, value: newRefreshToken);
    }

    await apiRequest(
      'POST',
      '/technician/orders/$orderId/${action == 'accept' ? 'accept' : 'reject'}',
      accessToken: newAccessToken,
    );
  } catch (err) {
    debugPrint('[push] فشل تنفيذ فعل "$action" من زرار الإشعار للطلب $orderId: $err');
  }
}
