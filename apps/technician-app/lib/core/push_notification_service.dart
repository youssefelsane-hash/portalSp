import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api_client.dart';
import 'deep_link_router.dart';

// نفس المفتاح بالحرف المستخدم في auth_repository.dart — لازم يتطابق عشان الفعل من زرار الإشعار
// (اللي بيشتغل من isolate خلفية منفصلة تمامًا، بلا أي وصول لحالة AuthRepository في الذاكرة) يقدر
// يقرا نفس الجلسة المحفوظة.
const _refreshTokenKey = 'baytak_refresh_token';
const _secureStorage = FlutterSecureStorage();

const _criticalOfferChannelId = 'critical_offer';
const _actionRequiredChannelId = 'action_required';
const _generalUpdatesChannelId = 'general_updates';

/// معرّف فئة إشعارات iOS لأزرار قبول/رفض. **ثابت واحد عمدًا**: القيمة دي لازم تتطابق بين مكان
/// التسجيل (`DarwinInitializationSettings.notificationCategories`) ومكان الاستخدام
/// (`DarwinNotificationDetails.categoryIdentifier`) — وكانت مكتوبة نصًا في مكان واحد بس والتاني
/// ناقص خالص، فiOS كان بيتجاهلها بصمت والإشعار يظهر بلا أزرار.
const _orderOfferCategoryId = 'ORDER_OFFER_ACTIONS';

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
    // iOS بيسجّل فئات الأزرار **مرة واحدة وقت التهيئة**، مش مع كل رسالة زي أندرويد — فأسماء
    // الأزرار هنا ثابتة ومطابقة للافتراضي في migration 0097 (`{"accept":"قبول","reject":"رفض"}`).
    // نتيجة مقصودة: `action_labels` اللي الأدمن بيعدّلها بتأثر على أندرويد بس؛ موثّقة في
    // docs/08 §124 كقيد منصة مش كفجوة.
    final iosInit = DarwinInitializationSettings(
      notificationCategories: <DarwinNotificationCategory>[
        DarwinNotificationCategory(
          _orderOfferCategoryId,
          actions: <DarwinNotificationAction>[
            DarwinNotificationAction.plain('accept', 'قبول'),
            DarwinNotificationAction.plain(
              'reject',
              'رفض',
              options: <DarwinNotificationActionOption>{DarwinNotificationActionOption.destructive},
            ),
          ],
          options: <DarwinNotificationCategoryOption>{
            DarwinNotificationCategoryOption.hiddenPreviewShowTitle,
          },
        ),
      ],
    );
    await _localNotifications.initialize(
      InitializationSettings(android: androidInit, iOS: iosInit),
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
    await androidPlugin?.createNotificationChannel(const AndroidNotificationChannel(
      _generalUpdatesChannelId,
      'تحديثات عامة',
      description: 'تقييمات، أرباح، وتحديثات تانية غير actionable',
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
        FirebaseMessaging.onMessage.listen(_onForegroundMessage);
        // التطبيق كان في الخلفية (مش مقفول) والفني ضغط على إشعار OS-drawn عادي (غير actionable —
        // ده بيتوصّل بـnotification block عادي، النظام بيعرضه تلقائي في الخلفية بلا أي كود منا).
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

      // التطبيق كان مقفول تمامًا (cold start) والفني فتحه بالضغط على إشعار OS-drawn عادي.
      final initialMessage = await messaging.getInitialMessage();
      if (initialMessage != null) {
        await handleDeepLink(initialMessage.data['deep_link'] as String?);
      }
    } catch (err) {
      debugPrint('[push] فشل تسجيل جهاز إشعارات push (متوقع من غير إعداد Firebase حقيقي): $err');
    }
  }
}

/// docs/08 §19 بند 11 — رسالة foreground (التطبيق مفتوح فعلاً): FCM مابيعرضش notification tray
/// تلقائي هنا حتى لو الرسالة عادية (`notification` block، مش data-only actionable) — لازم نبنيها
/// يدوي وإلا توصل بصمت تمامًا. actionable بتاخد مسارها المعتاد (§17.16)، وغير actionable بتاخد
/// إشعار محلي بسيط بلا أزرار.
Future<void> _onForegroundMessage(RemoteMessage message) async {
  if (message.data['actionable'] == 'true') {
    await _showActionableNotificationIfNeeded(message);
    return;
  }
  await _showPlainForegroundNotification(message);
}

Future<void> _showPlainForegroundNotification(RemoteMessage message) async {
  final title = message.notification?.title;
  final body = message.notification?.body;
  if (title == null && body == null) return;

  const androidDetails = AndroidNotificationDetails(
    _generalUpdatesChannelId,
    'تحديثات عامة',
    importance: Importance.high,
    priority: Priority.high,
  );
  const iosDetails = DarwinNotificationDetails();

  await _localNotifications.show(
    message.hashCode,
    title,
    body,
    const NotificationDetails(android: androidDetails, iOS: iosDetails),
    payload: jsonEncode(message.data),
  );
}

/// docs/08 §17.16 — بيبني إشعار محلي بأزرار قبول/رفض حقيقية من حمولة FCM data-only. إشعارات
/// عادية (informational مثلاً) بتوصل بـnotification block قياسي وبتتعامل تلقائيًا من نظام
/// التشغيل لما التطبيق في الخلفية/مقفول — foreground بس محتاج `_showPlainForegroundNotification`
/// فوق (actionable=false بترجع فورًا هنا لأنها مش مسؤوليتها).
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
    // بوابة P0-4 في docs/23 — **اتشال `fullScreenIntent` و`category.call` عمدًا**.
    //
    // Google بيقصر `USE_FULL_SCREEN_INTENT` أساسًا على تطبيقات المكالمات والمنبهات، وتطبيق
    // توزيع شغل مش منهم — الصلاحية دي سبب رفض متكرر في مراجعة المتجر، و`category.call`
    // بيدّعي إن ده نداء مكالمة وهو مش كده، وده بالظبط اللي المراجعة بتضرب فيه.
    //
    // **الإلحاح ما ضاعش**: `Importance.max` + `Priority.max` بيطلّعوا الإشعار كـheads-up فوق
    // أي شاشة، و`visibility: public` بيخلّي محتواه مقروء على شاشة القفل نفسها. الفرق الوحيد
    // إن الشاشة مبتفتحش بالكامل قسرًا — وده تنازل مقبول مقابل إن التطبيق يعدّي المراجعة أصلاً.
    category: AndroidNotificationCategory.event,
    visibility: NotificationVisibility.public,
    fullScreenIntent: false,
    actions: [
      if (actionLabels['accept'] is String) AndroidNotificationAction('accept', actionLabels['accept'] as String),
      if (actionLabels['reject'] is String) AndroidNotificationAction('reject', actionLabels['reject'] as String),
    ],
  );
  const iosDetails = DarwinNotificationDetails(categoryIdentifier: _orderOfferCategoryId);

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
/// الصفر عبر refresh_token المحفوظ في flutter_secure_storage.
///
/// **docs/08 §19 بند 11 — كانت فجوة موثّقة صراحة هنا بالحرف**: مجرد تاب على جسم الإشعار (مش
/// زرار) كان بيترك من غير فعل خالص. دلوقتي بينادي `handleDeepLink()` (نفس المسار اللي
/// `onMessageOpenedApp`/`getInitialMessage` بيستخدموه) — شغال فعليًا لما الإشعار ده إشعار محلي
/// (foreground) والتطبيق لسه شغال وقت التاب، لأن الـisolate عنده Navigator حقيقي وقتها.
/// **فجوة متبقية موثّقة صراحة، خارج نطاق ممكن التحقق منه هنا**: تاب على *جسم* إشعار actionable
/// (مش زراره) والتطبيق مقفول تمامًا وقتها بيوصل لنفس الكود ده بس من background isolate منفصل —
/// مفيش Navigator هناك أصلاً (isolate بلا UI)، فـ`handleDeepLink` بترجع بهدوء بلا أي فعل. محتاج
/// حل مختلف (`getNotificationAppLaunchDetails()` وقت الإقلاع البارد) لو حبينا نغطيه — نفس القيد
/// اللي أي محاولة اختبار حقيقي عليه محتاجة جهاز/emulator حقيقي أصلاً (موثّق في كل مكان تاني
/// بيستخدم نفس القيد في الجلسة دي).
void _handleNotificationAction(NotificationResponse response) {
  final payload = response.payload;
  if (payload == null) return;

  Map<String, dynamic> data;
  try {
    data = jsonDecode(payload) as Map<String, dynamic>;
  } catch (_) {
    return;
  }

  final actionId = response.actionId;
  if (actionId != 'accept' && actionId != 'reject') {
    unawaited(handleDeepLink(data['deep_link'] as String?));
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
